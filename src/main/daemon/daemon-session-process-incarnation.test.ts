import { describe, expect, it, vi } from 'vitest'
import {
  createProcessIncarnationResolver,
  type ProcessIncarnationProbeDependencies
} from './daemon-session-process-incarnation'

const BOOT_ID = '11111111-2222-3333-4444-555555555555'
const CREATION_DATE = '2026-07-16T20:01:02.1234567Z'
const CAPTURE_AT = Date.UTC(2026, 6, 17, 12, 0, 0)

function dependencies(
  overrides: Partial<ProcessIncarnationProbeDependencies> = {}
): ProcessIncarnationProbeDependencies {
  return {
    platform: 'linux',
    now: () => CAPTURE_AT,
    readBoundedFile: vi.fn(async (path: string) =>
      path.endsWith('boot_id') ? BOOT_ID : linuxStat(123)
    ),
    runCommand: vi.fn(async () => ({ stdout: '' })),
    ...overrides
  }
}

function linuxStat(startTicks: number | string, command = 'shell'): string {
  const fields = Array.from({ length: 20 }, () => '0')
  fields[0] = 'S'
  fields[19] = String(startTicks)
  return `123 (${command}) ${fields.join(' ')}`
}

function windowsRowsFromCommand(command: string): string {
  const pids = [...command.matchAll(/ProcessId = (\d+)/g)].map((match) => Number(match[1]))
  return JSON.stringify(pids.map((ProcessId) => ({ ProcessId, CreationDate: CREATION_DATE })))
}

describe('process incarnation resolver input contract', () => {
  it('returns an empty success without touching the OS', async () => {
    const deps = dependencies()
    const result = await createProcessIncarnationResolver(deps).probe([])

    expect(result).toEqual({
      status: 'success',
      reason: 'none',
      observations: [],
      externalProcessCount: 0
    })
    expect(deps.readBoundedFile).not.toHaveBeenCalled()
    expect(deps.runCommand).not.toHaveBeenCalled()
  })

  it('deduplicates valid PIDs in first-seen order', async () => {
    const deps = dependencies()
    const result = await createProcessIncarnationResolver(deps).probe([7, 7, 3, 7])

    expect(result.observations.map(({ pid }) => pid)).toEqual([7, 3])
    expect(deps.readBoundedFile).toHaveBeenCalledTimes(3)
  })

  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER])(
    'rejects invalid PID %s without probing',
    async (invalidPid) => {
      const deps = dependencies()
      const result = await createProcessIncarnationResolver(deps).probe([12, invalidPid])

      expect(result).toMatchObject({ status: 'failure', reason: 'invalid-input' })
      expect(result.observations).toEqual([{ pid: 12, state: 'unknown' }])
      expect(deps.readBoundedFile).not.toHaveBeenCalled()
    }
  )

  it('fails closed on unsupported platforms', async () => {
    const result = await createProcessIncarnationResolver(
      dependencies({ platform: 'freebsd' })
    ).probe([12])

    expect(result).toMatchObject({
      status: 'failure',
      reason: 'unsupported-platform',
      observations: [{ pid: 12, state: 'unknown' }]
    })
  })

  it('starts a distinct OS probe for every fresh-after-fence call', async () => {
    const runCommand = vi.fn(async () => ({ stdout: '7 Thu Jul 16 20:01:02 2026\n' }))
    const resolver = createProcessIncarnationResolver(
      dependencies({ platform: 'darwin', runCommand })
    )

    await resolver.probe([7])
    await resolver.probeFreshAfterFence([7])

    expect(runCommand).toHaveBeenCalledTimes(2)
  })
})

describe('Linux process incarnation probing', () => {
  it('combines the boot ID with raw start ticks and handles commands containing a parenthesis', async () => {
    const readBoundedFile = vi.fn(async (path: string) =>
      path.endsWith('boot_id') ? BOOT_ID.toUpperCase() : linuxStat('90071992547409931234', 'a ) b')
    )
    const result = await createProcessIncarnationResolver(dependencies({ readBoundedFile })).probe([
      123
    ])

    expect(result).toMatchObject({ status: 'success', externalProcessCount: 0 })
    expect(result.observations).toEqual([
      {
        pid: 123,
        state: 'observed',
        token: `linux:${BOOT_ID}:90071992547409931234`
      }
    ])
    expect(readBoundedFile).toHaveBeenNthCalledWith(1, '/proc/sys/kernel/random/boot_id', 128)
    expect(readBoundedFile).toHaveBeenNthCalledWith(2, '/proc/123/stat', 8 * 1024)
  })

  it('changes the token when Linux has rebooted', async () => {
    let bootId = BOOT_ID
    const readBoundedFile = vi.fn(async (path: string) =>
      path.endsWith('boot_id') ? bootId : linuxStat(44)
    )
    const resolver = createProcessIncarnationResolver(dependencies({ readBoundedFile }))

    const first = await resolver.probe([123])
    bootId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const second = await resolver.probe([123])

    expect(first.observations).not.toEqual(second.observations)
  })

  it('distinguishes a missing process from malformed and failed reads', async () => {
    const missing = Object.assign(new Error('gone'), { code: 'ENOENT' })
    const readBoundedFile = vi.fn(async (path: string) => {
      if (path.endsWith('boot_id')) {
        return BOOT_ID
      }
      if (path.includes('/1/')) {
        throw missing
      }
      if (path.includes('/2/')) {
        return '2 (bad) too short'
      }
      throw new Error('permission denied')
    })
    const result = await createProcessIncarnationResolver(dependencies({ readBoundedFile })).probe([
      1, 2, 3
    ])

    expect(result).toMatchObject({ status: 'failure', reason: 'probe-failed' })
    expect(result.observations).toEqual([
      { pid: 1, state: 'not-observed' },
      { pid: 2, state: 'unknown' },
      { pid: 3, state: 'unknown' }
    ])
  })

  it('makes every PID unknown when the bounded boot-ID read fails', async () => {
    const result = await createProcessIncarnationResolver(
      dependencies({
        readBoundedFile: vi.fn(async () => {
          throw new Error('overflow')
        })
      })
    ).probe([1, 2])

    expect(result).toMatchObject({ status: 'failure', reason: 'probe-failed' })
    expect(result.observations).toEqual([
      { pid: 1, state: 'unknown' },
      { pid: 2, state: 'unknown' }
    ])
  })

  it.each([1, 256, 257])('uses bounded asynchronous reads for %i PIDs', async (count) => {
    let active = 0
    let maxActive = 0
    const paths: string[] = []
    const readBoundedFile = vi.fn(async (path: string) => {
      paths.push(path)
      if (path.endsWith('boot_id')) {
        return BOOT_ID
      }
      active += 1
      maxActive = Math.max(maxActive, active)
      await Promise.resolve()
      active -= 1
      return linuxStat(77)
    })
    const pids = Array.from({ length: count }, (_, index) => index + 1)
    const result = await createProcessIncarnationResolver(dependencies({ readBoundedFile })).probe(
      pids
    )

    expect(result.status).toBe('success')
    expect(result.externalProcessCount).toBe(0)
    expect(paths).toHaveLength(count + 1)
    expect(maxActive).toBeLessThanOrEqual(32)
  })
})

describe('macOS process incarnation probing', () => {
  it('uses one bounded C/UTC full-table ps scan for 257 PIDs', async () => {
    const runCommand = vi.fn(async () => ({ stdout: '1 Thu Jul 16 20:01:02 2026\n' }))
    const pids = Array.from({ length: 257 }, (_, index) => index + 1)
    const result = await createProcessIncarnationResolver(
      dependencies({ platform: 'darwin', runCommand })
    ).probe(pids)

    expect(result.externalProcessCount).toBe(1)
    expect(runCommand).toHaveBeenCalledTimes(1)
    expect(runCommand).toHaveBeenCalledWith(
      'ps',
      ['-axo', 'pid=,lstart='],
      expect.objectContaining({
        encoding: 'utf8',
        timeout: 3_000,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
        env: expect.objectContaining({ LANG: 'C', LC_ALL: 'C', TZ: 'UTC0' })
      })
    )
  })

  it('separates observed, omitted, malformed, duplicate, and capture-second rows', async () => {
    const stdout = [
      '1 Thu Jul 16 20:01:02 2026',
      '3 localized-or-malformed-date',
      '4 Thu Jul 16 20:01:02 2026',
      '4 Thu Jul 16 20:01:02 2026',
      '5 Fri Jul 17 12:00:00 2026'
    ].join('\n')
    const result = await createProcessIncarnationResolver(
      dependencies({ platform: 'darwin', runCommand: vi.fn(async () => ({ stdout })) })
    ).probe([1, 2, 3, 4, 5])

    expect(result.status).toBe('success')
    expect(result.observations).toEqual([
      { pid: 1, state: 'observed', token: 'darwin:2026-07-16T20:01:02.000Z' },
      { pid: 2, state: 'not-observed' },
      { pid: 3, state: 'unknown' },
      { pid: 4, state: 'ambiguous' },
      { pid: 5, state: 'ambiguous' }
    ])
  })

  it('fails the whole probe on timeout or buffer overflow', async () => {
    const runCommand = vi.fn(async () => {
      throw new Error('timeout')
    })
    const result = await createProcessIncarnationResolver(
      dependencies({ platform: 'darwin', runCommand })
    ).probe([1, 2])

    expect(result).toEqual({
      status: 'failure',
      reason: 'probe-failed',
      observations: [
        { pid: 1, state: 'unknown' },
        { pid: 2, state: 'unknown' }
      ],
      externalProcessCount: 1
    })
  })

  it('fails closed when the wall clock rolls back during capture', async () => {
    let call = 0
    const result = await createProcessIncarnationResolver(
      dependencies({
        platform: 'darwin',
        now: () => (call++ === 0 ? CAPTURE_AT : CAPTURE_AT - 1),
        runCommand: vi.fn(async () => ({ stdout: '1 Thu Jul 16 20:01:02 2026\n' }))
      })
    ).probe([1])

    expect(result).toMatchObject({
      status: 'failure',
      observations: [{ pid: 1, state: 'unknown' }]
    })
  })
})

describe('Windows process incarnation probing', () => {
  it('spawns no PowerShell process for zero PIDs', async () => {
    const runCommand = vi.fn(async () => ({ stdout: '' }))
    const result = await createProcessIncarnationResolver(
      dependencies({ platform: 'win32', runCommand })
    ).probe([])

    expect(result.externalProcessCount).toBe(0)
    expect(runCommand).not.toHaveBeenCalled()
  })

  it.each([
    [1, 1],
    [256, 1],
    [257, 2]
  ])('uses %i PIDs in %i sequential CIM batches', async (count, expectedBatches) => {
    let active = 0
    let maxActive = 0
    const batchSizes: number[] = []
    const runCommand = vi.fn(async (_file: string, args: string[]) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      const command = args.at(-1) ?? ''
      batchSizes.push([...command.matchAll(/ProcessId = (\d+)/g)].length)
      await Promise.resolve()
      active -= 1
      return { stdout: windowsRowsFromCommand(command) }
    })
    const pids = Array.from({ length: count }, (_, index) => index + 1)
    const result = await createProcessIncarnationResolver(
      dependencies({ platform: 'win32', runCommand })
    ).probe(pids)

    expect(result.status).toBe('success')
    expect(result.externalProcessCount).toBe(expectedBatches)
    expect(runCommand).toHaveBeenCalledTimes(expectedBatches)
    expect(batchSizes.every((size) => size <= 256)).toBe(true)
    expect(maxActive).toBe(1)
  })

  it('uses strict hidden UTF-8 PowerShell/CIM command options', async () => {
    const runCommand = vi.fn(async (_file: string, args: string[]) => ({
      stdout: windowsRowsFromCommand(args.at(-1) ?? '')
    }))
    await createProcessIncarnationResolver(dependencies({ platform: 'win32', runCommand })).probe([
      8
    ])

    expect(runCommand).toHaveBeenCalledWith(
      'powershell.exe',
      expect.arrayContaining(['-NoProfile', '-NonInteractive', '-Command']),
      {
        encoding: 'utf8',
        timeout: 3_000,
        maxBuffer: 1024 * 1024,
        windowsHide: true
      }
    )
    const command = runCommand.mock.calls[0][1].at(-1)
    expect(command).toContain('Get-CimInstance -ClassName Win32_Process')
    expect(command).toContain('[System.Globalization.CultureInfo]::InvariantCulture')
  })

  it.each([
    ['', [{ pid: 1, state: 'unknown' }]],
    [
      JSON.stringify({ ProcessId: 1, CreationDate: CREATION_DATE }),
      [{ pid: 1, state: 'observed', token: `win32:${CREATION_DATE}` }]
    ],
    [
      JSON.stringify([
        { ProcessId: 1, CreationDate: CREATION_DATE },
        { ProcessId: 2, CreationDate: null }
      ]),
      [
        { pid: 1, state: 'observed', token: `win32:${CREATION_DATE}` },
        { pid: 2, state: 'unknown' },
        { pid: 3, state: 'unknown' }
      ]
    ]
  ])(
    'parses empty, singleton, and array output without fail-open omission',
    async (stdout, expected) => {
      const pids = expected.map(({ pid }) => pid)
      const result = await createProcessIncarnationResolver(
        dependencies({ platform: 'win32', runCommand: vi.fn(async () => ({ stdout })) })
      ).probe(pids)

      expect(result.status).toBe('success')
      expect(result.observations).toEqual(expected)
    }
  )

  it('marks duplicate PID rows ambiguous', async () => {
    const stdout = JSON.stringify([
      { ProcessId: 1, CreationDate: CREATION_DATE },
      { ProcessId: 1, CreationDate: CREATION_DATE }
    ])
    const result = await createProcessIncarnationResolver(
      dependencies({ platform: 'win32', runCommand: vi.fn(async () => ({ stdout })) })
    ).probe([1])

    expect(result.observations).toEqual([{ pid: 1, state: 'ambiguous' }])
  })

  it.each(['not-json', JSON.stringify({ ProcessId: 1, CreationDate: 'localized date' })])(
    'fails a malformed batch closed: %s',
    async (stdout) => {
      const result = await createProcessIncarnationResolver(
        dependencies({ platform: 'win32', runCommand: vi.fn(async () => ({ stdout })) })
      ).probe([1, 2])

      expect(result).toMatchObject({ status: 'failure', reason: 'probe-failed' })
      expect(result.observations).toEqual([
        { pid: 1, state: 'unknown' },
        { pid: 2, state: 'unknown' }
      ])
    }
  )

  it('keeps other batch results but reports failure when one batch times out', async () => {
    let call = 0
    const runCommand = vi.fn(async (_file: string, args: string[]) => {
      call += 1
      if (call === 1) {
        throw new Error('timeout')
      }
      return { stdout: windowsRowsFromCommand(args.at(-1) ?? '') }
    })
    const pids = Array.from({ length: 257 }, (_, index) => index + 1)
    const result = await createProcessIncarnationResolver(
      dependencies({ platform: 'win32', runCommand })
    ).probe(pids)

    expect(result.status).toBe('failure')
    expect(result.observations[0]).toEqual({ pid: 1, state: 'unknown' })
    expect(result.observations.at(-1)).toEqual({
      pid: 257,
      state: 'observed',
      token: `win32:${CREATION_DATE}`
    })
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import type * as NodeOs from 'node:os'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CodexManagedTrustGrantPlan } from './codex-hook-trust-grant'

const { homedirMock, grantMock } = vi.hoisted(() => ({
  homedirMock: vi.fn<() => string>(),
  grantMock: vi.fn()
}))

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof NodeOs>('node:os')
  return { ...actual, homedir: homedirMock }
})

vi.mock('./codex-hook-trust-grant', () => ({
  grantManagedCodexHookTrust: grantMock
}))

import {
  ensureRealHomeCodexHookState,
  getRealHomeCodexHookLane,
  _internals
} from './codex-real-home-hook-install'
import { getCodexManagedHookInstallMaterial } from './hook-service'

let fakeHomeDir: string
let userDataDir: string
let previousUserDataPath: string | undefined

function getRealHooksJsonPath(): string {
  return join(fakeHomeDir, '.codex', 'hooks.json')
}

function readRealHooksJson(): {
  hooks?: Record<string, { hooks?: { command?: string }[] }[]>
  [key: string]: unknown
} {
  return JSON.parse(readFileSync(getRealHooksJsonPath(), 'utf-8'))
}

function grantSucceeds(): void {
  grantMock.mockImplementation((plan: CodexManagedTrustGrantPlan) => ({
    lane: 'rpc',
    entries: plan.managedEntries.map((entry) => ({ ...entry, trustedHash: 'codex-hash' }))
  }))
}

function grantUnavailable(): void {
  grantMock.mockReturnValue({ lane: 'fallback', reason: 'unsupported' })
}

beforeEach(() => {
  grantMock.mockReset()
  fakeHomeDir = mkdtempSync(join(tmpdir(), 'orca-real-home-hooks-home-'))
  userDataDir = mkdtempSync(join(tmpdir(), 'orca-real-home-hooks-user-data-'))
  previousUserDataPath = process.env.ORCA_USER_DATA_PATH
  process.env.ORCA_USER_DATA_PATH = userDataDir
  homedirMock.mockReturnValue(fakeHomeDir)
  mkdirSync(join(fakeHomeDir, '.codex'), { recursive: true })
  _internals.setLaneForTesting('pending')
})

afterEach(() => {
  rmSync(fakeHomeDir, { recursive: true, force: true })
  rmSync(userDataDir, { recursive: true, force: true })
  if (previousUserDataPath === undefined) {
    delete process.env.ORCA_USER_DATA_PATH
  } else {
    process.env.ORCA_USER_DATA_PATH = previousUserDataPath
  }
  vi.clearAllMocks()
})

describe('ensureRealHomeCodexHookState (install)', () => {
  it('creates hooks.json with the Orca entry in every managed event for a fresh home', () => {
    grantSucceeds()

    const lane = ensureRealHomeCodexHookState({ hooksEnabled: true, userDataPath: userDataDir })

    expect(lane).toBe('installed')
    const material = getCodexManagedHookInstallMaterial()
    const config = readRealHooksJson()
    for (const eventName of material.events) {
      const definitions = config.hooks?.[eventName]
      expect(definitions).toHaveLength(1)
      expect(definitions?.[0]?.hooks?.[0]?.command).toBe(material.command)
    }
    // The grant plan targeted the real home with append-position trust keys.
    const plan = grantMock.mock.calls[0]![0] as CodexManagedTrustGrantPlan
    expect(plan.runtimeHomePath).toBe(join(fakeHomeDir, '.codex'))
    expect(plan.host).toEqual({ kind: 'native' })
    expect(plan.managedEntries.every((entry) => entry.groupIndex === 0)).toBe(true)
  })

  it('appends LAST and preserves user entries, unknown fields, and trust positions', () => {
    grantSucceeds()
    const userConfig = {
      hooks: {
        Stop: [{ matcher: 'deploy-*', hooks: [{ type: 'command', command: 'my-stop-hook.sh' }] }],
        PreCompact: [{ hooks: [{ type: 'command', command: 'my-compact-hook.sh' }] }]
      },
      _pluginManagerMetadata: { owner: 'someone-else' }
    }
    writeFileSync(getRealHooksJsonPath(), `${JSON.stringify(userConfig, null, 2)}\n`, 'utf-8')

    const lane = ensureRealHomeCodexHookState({ hooksEnabled: true, userDataPath: userDataDir })

    expect(lane).toBe('installed')
    const config = readRealHooksJson()
    // User's Stop entry keeps position 0; Orca's entry is appended after it.
    expect(config.hooks?.Stop).toHaveLength(2)
    expect(config.hooks?.Stop?.[0]).toEqual(userConfig.hooks.Stop[0])
    // Non-managed events Orca does not subscribe to stay untouched.
    expect(config.hooks?.PreCompact).toEqual(userConfig.hooks.PreCompact)
    // Unknown top-level metadata survives, unlike the managed-home writer.
    expect(config._pluginManagerMetadata).toEqual(userConfig._pluginManagerMetadata)
    // The appended entry's trust key uses its appended position.
    const plan = grantMock.mock.calls[0]![0] as CodexManagedTrustGrantPlan
    const stopEntry = plan.managedEntries.find((entry) => entry.eventLabel === 'stop')
    expect(stopEntry?.groupIndex).toBe(1)
    // Pristine pre-Orca backup lands under userData, not in ~/.codex.
    expect(
      readFileSync(join(userDataDir, 'codex-real-home-hooks', 'hooks.json.pre-orca'), 'utf-8')
    ).toBe(`${JSON.stringify(userConfig, null, 2)}\n`)
  })

  it('rolls the file back byte-exactly when the grant lane is unavailable', () => {
    grantUnavailable()
    const userRaw = `${JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'mine.sh' }] }] } }, null, 2)}\n`
    writeFileSync(getRealHooksJsonPath(), userRaw, 'utf-8')

    const lane = ensureRealHomeCodexHookState({ hooksEnabled: true, userDataPath: userDataDir })

    expect(lane).toBe('unavailable')
    expect(getRealHomeCodexHookLane()).toBe('unavailable')
    expect(readFileSync(getRealHooksJsonPath(), 'utf-8')).toBe(userRaw)
  })

  it('removes a freshly created hooks.json when the grant lane is unavailable', () => {
    grantUnavailable()

    const lane = ensureRealHomeCodexHookState({ hooksEnabled: true, userDataPath: userDataDir })

    expect(lane).toBe('unavailable')
    expect(existsSync(getRealHooksJsonPath())).toBe(false)
  })

  it('leaves an unparseable hooks.json untouched and keeps the managed lane', () => {
    writeFileSync(getRealHooksJsonPath(), '{not json', 'utf-8')

    const lane = ensureRealHomeCodexHookState({ hooksEnabled: true, userDataPath: userDataDir })

    expect(lane).toBe('unavailable')
    expect(readFileSync(getRealHooksJsonPath(), 'utf-8')).toBe('{not json')
    expect(grantMock).not.toHaveBeenCalled()
  })

  it('is idempotent: a second ensure keeps a single appended entry per event', () => {
    grantSucceeds()
    ensureRealHomeCodexHookState({ hooksEnabled: true, userDataPath: userDataDir })
    const firstRaw = readFileSync(getRealHooksJsonPath(), 'utf-8')

    const lane = ensureRealHomeCodexHookState({ hooksEnabled: true, userDataPath: userDataDir })

    expect(lane).toBe('installed')
    expect(readFileSync(getRealHooksJsonPath(), 'utf-8')).toBe(firstRaw)
  })
})

describe('ensureRealHomeCodexHookState (opt-out sweep)', () => {
  it('removes only Orca entries and reports the removed lane', () => {
    grantSucceeds()
    const userStop = {
      matcher: 'deploy-*',
      hooks: [{ type: 'command', command: 'my-stop-hook.sh' }]
    }
    writeFileSync(
      getRealHooksJsonPath(),
      `${JSON.stringify({ hooks: { Stop: [userStop] } }, null, 2)}\n`,
      'utf-8'
    )
    ensureRealHomeCodexHookState({ hooksEnabled: true, userDataPath: userDataDir })
    expect(readRealHooksJson().hooks?.Stop).toHaveLength(2)

    const lane = ensureRealHomeCodexHookState({ hooksEnabled: false, userDataPath: userDataDir })

    expect(lane).toBe('removed')
    const config = readRealHooksJson()
    expect(config.hooks?.Stop).toEqual([userStop])
    const material = getCodexManagedHookInstallMaterial()
    for (const eventName of material.events) {
      if (eventName === 'Stop') {
        continue
      }
      expect(config.hooks?.[eventName]).toBeUndefined()
    }
  })

  it('no-ops the sweep when the real home has no hooks.json', () => {
    const lane = ensureRealHomeCodexHookState({ hooksEnabled: false, userDataPath: userDataDir })

    expect(lane).toBe('removed')
    expect(existsSync(getRealHooksJsonPath())).toBe(false)
  })
})

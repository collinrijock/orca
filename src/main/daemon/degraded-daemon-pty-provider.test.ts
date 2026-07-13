import { describe, expect, it, vi } from 'vitest'
import { DegradedDaemonPtyProvider } from './degraded-daemon-pty-provider'
import type { DaemonPtyAdapter } from './daemon-pty-adapter'
import type { IPtyProvider, PtySpawnOptions, PtySpawnResult } from '../providers/types'

type ProviderMock = IPtyProvider & {
  emitData: (id: string, data: string, sequenceChars?: number) => void
  emitReplay: (id: string, data: string) => void
  emitExit: (id: string, code: number) => void
}

function createProvider(label: string, sessions: string[] = []): ProviderMock {
  const dataListeners: ((payload: { id: string; data: string; sequenceChars?: number }) => void)[] =
    []
  const replayListeners: ((payload: { id: string; data: string }) => void)[] = []
  const exitListeners: ((payload: { id: string; code: number }) => void)[] = []
  return {
    spawn: vi.fn(async (opts: PtySpawnOptions): Promise<PtySpawnResult> => {
      const id = opts.sessionId ?? `${label}-new`
      sessions.push(id)
      return { id }
    }),
    attach: vi.fn(async () => {}),
    hasPty: vi.fn((id: string) => sessions.includes(id)),
    write: vi.fn(),
    resize: vi.fn(),
    shutdown: vi.fn(async (id: string) => {
      const idx = sessions.indexOf(id)
      if (idx !== -1) {
        sessions.splice(idx, 1)
      }
    }),
    sendSignal: vi.fn(async () => {}),
    getCwd: vi.fn(async () => ''),
    getInitialCwd: vi.fn(async () => ''),
    clearBuffer: vi.fn(async () => {}),
    acknowledgeDataEvent: vi.fn(),
    hasChildProcesses: vi.fn(async () => false),
    getForegroundProcess: vi.fn(async () => null),
    confirmForegroundProcess: vi.fn(async () => `${label}-confirmed`),
    serialize: vi.fn(async () => '{}'),
    revive: vi.fn(async () => {}),
    listProcesses: vi.fn(async () => sessions.map((id) => ({ id, cwd: '', title: label }))),
    getDefaultShell: vi.fn(async () => '/bin/zsh'),
    getProfiles: vi.fn(async () => []),
    onData: vi.fn(
      (callback: (payload: { id: string; data: string; sequenceChars?: number }) => void) => {
        dataListeners.push(callback)
        return () => {
          const idx = dataListeners.indexOf(callback)
          if (idx !== -1) {
            dataListeners.splice(idx, 1)
          }
        }
      }
    ),
    onReplay: vi.fn((callback: (payload: { id: string; data: string }) => void) => {
      replayListeners.push(callback)
      return () => {
        const idx = replayListeners.indexOf(callback)
        if (idx !== -1) {
          replayListeners.splice(idx, 1)
        }
      }
    }),
    onExit: vi.fn((callback: (payload: { id: string; code: number }) => void) => {
      exitListeners.push(callback)
      return () => {
        const idx = exitListeners.indexOf(callback)
        if (idx !== -1) {
          exitListeners.splice(idx, 1)
        }
      }
    }),
    emitData: (id: string, data: string, sequenceChars?: number) => {
      for (const listener of dataListeners) {
        listener({ id, data, ...(sequenceChars === undefined ? {} : { sequenceChars }) })
      }
    },
    emitReplay: (id: string, data: string) => {
      for (const listener of replayListeners) {
        listener({ id, data })
      }
    },
    emitExit: (id: string, code: number) => {
      for (const listener of exitListeners) {
        listener({ id, code })
      }
    }
  }
}

function createDaemonAdapter(
  label: string,
  sessions: string[] = []
): DaemonPtyAdapter & ProviderMock {
  return {
    ...createProvider(label, sessions),
    protocolVersion: 13,
    listSessions: vi.fn(async () => []),
    ackColdRestore: vi.fn(),
    clearTombstone: vi.fn(),
    reconcileOnStartup: vi.fn(async () => ({ alive: sessions, killed: [] })),
    dispose: vi.fn(),
    disconnectOnly: vi.fn(async () => {}),
    getActiveSessionIds: vi.fn(() => []),
    fanoutSyntheticExits: vi.fn()
  } as unknown as DaemonPtyAdapter & ProviderMock
}

describe('DegradedDaemonPtyProvider', () => {
  it('retains the exact child route until exit proof', async () => {
    const daemonSessions = ['shared-session']
    const current = createDaemonAdapter('daemon', daemonSessions)
    const fallback = createProvider('fallback')
    vi.mocked(current.shutdown).mockResolvedValueOnce(undefined)
    const provider = new DegradedDaemonPtyProvider({ current, legacy: [], fallback })
    await provider.discoverDaemonSessions()

    expect(provider.requiresShutdownExitProof).toBe(true)
    await provider.shutdown('shared-session', { immediate: true })
    provider.write('shared-session', 'before-exit')

    expect(current.write).toHaveBeenCalledWith('shared-session', 'before-exit')
    daemonSessions.length = 0
    current.emitExit('shared-session', 0)
    provider.write('shared-session', 'after-exit')
    expect(fallback.write).toHaveBeenCalledWith('shared-session', 'after-exit')
  })

  it('retains a same-provider replacement across an older process listing', async () => {
    const current = createDaemonAdapter('daemon', ['shared-session'])
    const fallback = createProvider('fallback')
    const provider = new DegradedDaemonPtyProvider({ current, legacy: [], fallback })
    await provider.discoverDaemonSessions()
    let finishDaemonListing!: (sessions: []) => void
    vi.mocked(current.listProcesses).mockImplementationOnce(
      () => new Promise((resolve) => (finishDaemonListing = resolve))
    )

    const staleListing = provider.listProcesses()
    await provider.spawn({ sessionId: 'shared-session', cols: 80, rows: 24 })
    finishDaemonListing([])
    await staleListing
    provider.write('shared-session', 'replacement')

    expect(provider.getCurrentDaemonSessionIds()).toEqual(['shared-session'])
    expect(current.write).toHaveBeenCalledWith('shared-session', 'replacement')
    expect(fallback.write).not.toHaveBeenCalledWith('shared-session', 'replacement')
  })

  it('defers a fallback old exit until replacement spawn proves the id live', async () => {
    const fallbackSessions: string[] = []
    const current = createDaemonAdapter('daemon')
    const fallback = createProvider('fallback', fallbackSessions)
    const provider = new DegradedDaemonPtyProvider({ current, legacy: [], fallback })
    const exit = vi.fn()
    provider.onExit(exit)
    await provider.spawn({ sessionId: 'same-id', cols: 80, rows: 24 })
    await provider.shutdown('same-id', { immediate: true })
    await provider.listProcesses()

    let resolveSpawn!: (result: PtySpawnResult) => void
    vi.mocked(fallback.spawn).mockImplementationOnce(
      () => new Promise((resolve) => (resolveSpawn = resolve))
    )
    const replacement = provider.spawn({ sessionId: 'same-id', cols: 80, rows: 24 })
    await vi.waitFor(() => expect(fallback.spawn).toHaveBeenCalledTimes(2))
    fallback.emitExit('same-id', 7)
    expect(exit).not.toHaveBeenCalled()

    fallbackSessions.push('same-id')
    resolveSpawn({ id: 'same-id' })
    await replacement
    provider.write('same-id', 'replacement')

    expect(exit).not.toHaveBeenCalled()
    expect(fallback.write).toHaveBeenCalledWith('same-id', 'replacement')
  })

  it('delivers a deferred fallback exit when replacement spawn fails with no live id', async () => {
    const current = createDaemonAdapter('daemon')
    const fallback = createProvider('fallback')
    const provider = new DegradedDaemonPtyProvider({ current, legacy: [], fallback })
    const exit = vi.fn()
    provider.onExit(exit)
    let rejectSpawn!: (error: Error) => void
    vi.mocked(fallback.spawn).mockImplementationOnce(
      () => new Promise((_resolve, reject) => (rejectSpawn = reject))
    )

    const replacement = provider.spawn({ sessionId: 'same-id', cols: 80, rows: 24 })
    await vi.waitFor(() => expect(fallback.spawn).toHaveBeenCalledOnce())
    fallback.emitExit('same-id', 7)
    rejectSpawn(new Error('spawn failed'))

    await expect(replacement).rejects.toThrow('spawn failed')
    expect(exit).toHaveBeenCalledWith({ id: 'same-id', code: 7 })
  })

  it('rejects overlapping fallback spawn before it can overwrite deferred exit proof', async () => {
    const current = createDaemonAdapter('daemon')
    const fallback = createProvider('fallback')
    const provider = new DegradedDaemonPtyProvider({ current, legacy: [], fallback })
    const exit = vi.fn()
    provider.onExit(exit)
    let rejectSpawn!: (error: Error) => void
    vi.mocked(fallback.spawn).mockImplementationOnce(
      () => new Promise((_resolve, reject) => (rejectSpawn = reject))
    )

    const first = provider.spawn({ sessionId: 'same-id', cols: 80, rows: 24 })
    await vi.waitFor(() => expect(fallback.spawn).toHaveBeenCalledOnce())
    await expect(provider.spawn({ sessionId: 'same-id', cols: 80, rows: 24 })).rejects.toThrow(
      'PTY spawn already in progress'
    )
    fallback.emitExit('same-id', 7)
    rejectSpawn(new Error('first spawn failed'))

    await expect(first).rejects.toThrow('first spawn failed')
    expect(fallback.spawn).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledOnce()
  })

  it('routes fresh foreground confirmation to the session owner', async () => {
    const current = createDaemonAdapter('daemon', ['daemon-session'])
    const fallback = createProvider('fallback')
    const provider = new DegradedDaemonPtyProvider({ current, legacy: [], fallback })
    await provider.discoverDaemonSessions()
    const fresh = await provider.spawn({ cols: 80, rows: 24 })

    await expect(provider.confirmForegroundProcess('daemon-session')).resolves.toBe(
      'daemon-confirmed'
    )
    await expect(provider.confirmForegroundProcess(fresh.id)).resolves.toBe('fallback-confirmed')
  })

  it('routes discovered daemon sessions to the daemon and fresh PTYs to the fallback', async () => {
    const current = createDaemonAdapter('daemon', ['daemon-session'])
    const fallback = createProvider('fallback')
    const provider = new DegradedDaemonPtyProvider({ current, legacy: [], fallback })

    await provider.discoverDaemonSessions()

    await provider.spawn({ sessionId: 'daemon-session', cols: 80, rows: 24 })
    const fresh = await provider.spawn({ cols: 80, rows: 24 })
    provider.write('daemon-session', 'old\n')
    provider.write(fresh.id, 'new\n')

    expect(current.spawn).toHaveBeenCalledWith({ sessionId: 'daemon-session', cols: 80, rows: 24 })
    expect(fallback.spawn).toHaveBeenCalledWith({ cols: 80, rows: 24 })
    expect(current.write).toHaveBeenCalledWith('daemon-session', 'old\n')
    expect(fallback.write).toHaveBeenCalledWith(fresh.id, 'new\n')
  })

  it('routes a previously daemon-backed id to fallback after daemon exit removes the mapping', async () => {
    const current = createDaemonAdapter('daemon', ['daemon-session'])
    const fallback = createProvider('fallback')
    const provider = new DegradedDaemonPtyProvider({ current, legacy: [], fallback })

    await provider.discoverDaemonSessions()
    current.emitExit('daemon-session', 0)
    await provider.spawn({ sessionId: 'daemon-session', cols: 80, rows: 24 })

    expect(fallback.spawn).toHaveBeenCalledWith({
      sessionId: 'daemon-session',
      cols: 80,
      rows: 24
    })
  })

  it('caches a provider discovered by hasPty before routing later operations', () => {
    const current = createDaemonAdapter('daemon', ['daemon-session'])
    const fallback = createProvider('fallback')
    const provider = new DegradedDaemonPtyProvider({ current, legacy: [], fallback })

    expect(provider.hasPty('daemon-session')).toBe(true)
    provider.write('daemon-session', 'kept-on-daemon\n')

    expect(current.write).toHaveBeenCalledWith('daemon-session', 'kept-on-daemon\n')
    expect(fallback.write).not.toHaveBeenCalled()
  })

  it('routes authoritative recovery snapshots to the owning daemon', async () => {
    const current = createDaemonAdapter('daemon', ['daemon-session'])
    const fallback = createProvider('fallback')
    const snapshot = {
      data: 'alt frame',
      scrollbackAnsi: 'normal history',
      cols: 80,
      rows: 24,
      seq: 42,
      source: 'headless' as const
    }
    current.getBufferSnapshot = vi.fn(async () => snapshot)
    const provider = new DegradedDaemonPtyProvider({ current, legacy: [], fallback })

    await provider.discoverDaemonSessions()

    await expect(
      provider.getBufferSnapshot('daemon-session', { scrollbackRows: 50_000 })
    ).resolves.toEqual(snapshot)
    expect(current.getBufferSnapshot).toHaveBeenCalledWith('daemon-session', {
      scrollbackRows: 50_000
    })
  })

  it('forwards replay output from fallback and daemon providers', () => {
    const current = createDaemonAdapter('daemon')
    const fallback = createProvider('fallback')
    const provider = new DegradedDaemonPtyProvider({ current, legacy: [], fallback })
    const replaySpy = vi.fn()

    const unsubscribe = provider.onReplay(replaySpy)
    current.emitReplay('daemon-session', 'daemon replay')
    fallback.emitReplay('fallback-session', 'fallback replay')
    unsubscribe()
    current.emitReplay('daemon-session', 'after unsubscribe')

    expect(replaySpy).toHaveBeenCalledTimes(2)
    expect(replaySpy).toHaveBeenNthCalledWith(1, {
      id: 'daemon-session',
      data: 'daemon replay'
    })
    expect(replaySpy).toHaveBeenNthCalledWith(2, {
      id: 'fallback-session',
      data: 'fallback replay'
    })
  })

  it('preserves explicit sequence accounting on daemon data events', () => {
    const current = createDaemonAdapter('daemon')
    const fallback = createProvider('fallback')
    const provider = new DegradedDaemonPtyProvider({ current, legacy: [], fallback })
    const dataSpy = vi.fn()
    provider.onData(dataSpy)

    current.emitData('daemon-session', '\x1b[6n', 0)

    expect(dataSpy).toHaveBeenCalledWith({
      id: 'daemon-session',
      data: '\x1b[6n',
      sequenceChars: 0
    })
  })

  it('detaches provider subscriptions without disposing the underlying providers', () => {
    const current = createDaemonAdapter('daemon')
    const fallback = createProvider('fallback')
    const provider = new DegradedDaemonPtyProvider({ current, legacy: [], fallback })
    const dataSpy = vi.fn()
    const exitSpy = vi.fn()
    provider.onData(dataSpy)
    provider.onExit(exitSpy)

    provider.disposeProviderOnly()
    current.emitData('daemon-session', 'data')
    fallback.emitExit('fallback-session', 0)

    expect(dataSpy).not.toHaveBeenCalled()
    expect(exitSpy).not.toHaveBeenCalled()
    expect(current.dispose).not.toHaveBeenCalled()
  })

  it('shuts down fallback sessions before a daemon-provider swap', async () => {
    const current = createDaemonAdapter('daemon')
    const fallback = createProvider('fallback')
    const provider = new DegradedDaemonPtyProvider({ current, legacy: [], fallback })

    const fresh = await provider.spawn({ cols: 80, rows: 24 })
    const killedCount = await provider.shutdownFallbackSessions()

    expect(killedCount).toBe(1)
    expect(fallback.shutdown).toHaveBeenCalledWith(fresh.id, { immediate: true })
    expect(provider.hasPty(fresh.id)).toBe(false)
  })

  it('blocks provider replacement when a fallback shutdown rejects', async () => {
    const current = createDaemonAdapter('daemon')
    const fallback = createProvider('fallback')
    const provider = new DegradedDaemonPtyProvider({ current, legacy: [], fallback })
    const stuck = await provider.spawn({ sessionId: 'stuck', cols: 80, rows: 24 })
    await provider.spawn({ sessionId: 'ok', cols: 80, rows: 24 })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(fallback.shutdown).mockImplementation(async (id: string) => {
      if (id === stuck.id) {
        throw new Error('still alive')
      }
    })

    await expect(provider.shutdownFallbackSessions()).rejects.toThrow(
      'Cannot restart daemon while local fallback PTY exit remains unconfirmed'
    )

    expect(warn).toHaveBeenCalled()
    expect(fallback.shutdown).toHaveBeenCalledWith('stuck', { immediate: true })
    expect(fallback.shutdown).toHaveBeenCalledWith('ok', { immediate: true })
    expect(provider.hasPty('stuck')).toBe(true)
    warn.mockRestore()
  })

  it('blocks provider replacement after accepted fallback shutdown without exit proof', async () => {
    const fallbackSessions: string[] = []
    const current = createDaemonAdapter('daemon')
    const fallback = createProvider('fallback', fallbackSessions)
    Object.defineProperty(fallback, 'requiresShutdownExitProof', { value: true })
    vi.mocked(fallback.shutdown).mockResolvedValue(undefined)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const provider = new DegradedDaemonPtyProvider({ current, legacy: [], fallback })
    await provider.spawn({ sessionId: 'still-live-a', cols: 80, rows: 24 })
    await provider.spawn({ sessionId: 'still-live-b', cols: 80, rows: 24 })

    await expect(provider.shutdownFallbackSessions()).rejects.toThrow(
      'Cannot restart daemon while local fallback PTY exit remains unconfirmed'
    )

    expect(fallback.shutdown).toHaveBeenCalledTimes(2)
    expect(fallback.listProcesses).toHaveBeenCalledOnce()
    expect(provider.hasPty('still-live-a')).toBe(true)
    expect(provider.hasPty('still-live-b')).toBe(true)
    provider.write('still-live-a', 'route-retained')
    expect(fallback.write).toHaveBeenCalledWith('still-live-a', 'route-retained')
    warn.mockRestore()
  })

  it('allows replacement when inventory proves death after fallback shutdown throws', async () => {
    const fallbackSessions: string[] = []
    const current = createDaemonAdapter('daemon')
    const fallback = createProvider('fallback', fallbackSessions)
    Object.defineProperty(fallback, 'requiresShutdownExitProof', { value: true })
    vi.mocked(fallback.shutdown).mockImplementation(async (id: string) => {
      fallbackSessions.splice(fallbackSessions.indexOf(id), 1)
      throw new Error('native close threw after process exit')
    })
    const provider = new DegradedDaemonPtyProvider({ current, legacy: [], fallback })
    await provider.spawn({ sessionId: 'proved-dead', cols: 80, rows: 24 })

    await expect(provider.shutdownFallbackSessions()).resolves.toBe(1)

    expect(fallback.listProcesses).toHaveBeenCalledOnce()
    expect(provider.hasPty('proved-dead')).toBe(false)
  })

  it('fans synthetic exits for discovered current-daemon sessions only', async () => {
    const current = createDaemonAdapter('daemon', ['current-session'])
    const legacy = createDaemonAdapter('legacy', ['legacy-session'])
    const fallback = createProvider('fallback')
    const provider = new DegradedDaemonPtyProvider({ current, legacy: [legacy], fallback })
    const exitSpy = vi.fn()
    provider.onExit(exitSpy)

    await provider.discoverDaemonSessions()
    provider.fanoutCurrentDaemonSyntheticExits(-1)

    expect(exitSpy).toHaveBeenCalledOnce()
    expect(exitSpy).toHaveBeenCalledWith({ id: 'current-session', code: -1 })
    expect(provider.getCurrentDaemonSessionIds()).toEqual([])
    expect(provider.hasPty('legacy-session')).toBe(true)
  })
})

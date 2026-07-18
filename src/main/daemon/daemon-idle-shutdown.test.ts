import { EventEmitter } from 'node:events'
import { connect, type Socket } from 'node:net'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DaemonClient } from './client'
import { DaemonServer } from './daemon-server'
import {
  getDaemonPidPath,
  getDaemonSocketPath,
  serializeDaemonPidFile,
  unlinkOwnedDaemonPidFile
} from './daemon-spawner'
import type { SubprocessHandle } from './session'

type ManualTimer = {
  callback: () => void
  dueAt: number
  cancelled: boolean
}

class ManualIdleClock {
  private now = 0
  private timers = new Set<ManualTimer>()

  setTimeout(callback: () => void, delayMs: number): ManualTimer {
    const timer = { callback, dueAt: this.now + delayMs, cancelled: false }
    this.timers.add(timer)
    return timer
  }

  clearTimeout(handle: unknown): void {
    const timer = handle as ManualTimer
    timer.cancelled = true
    this.timers.delete(timer)
  }

  advanceBy(ms: number): void {
    this.now += ms
    for (const timer of [...this.timers].sort((a, b) => a.dueAt - b.dueAt)) {
      if (timer.cancelled || timer.dueAt > this.now) {
        continue
      }
      this.timers.delete(timer)
      timer.callback()
    }
  }

  get pendingCount(): number {
    return this.timers.size
  }
}

function createMockSubprocess(): SubprocessHandle & { exit(code: number): void } {
  let onExit: ((code: number) => void) | null = null
  return {
    pid: 9345,
    getForegroundProcess: () => null,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    forceKill: vi.fn(),
    signal: vi.fn(),
    onData: vi.fn(),
    onExit(callback) {
      onExit = callback
    },
    dispose: vi.fn(),
    exit(code) {
      onExit?.(code)
    }
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for daemon idle state')
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

describe('current daemon idle shutdown', () => {
  let dir: string
  let socketPath: string
  let tokenPath: string
  let pidPath: string
  let clock: ManualIdleClock
  let server: DaemonServer | null
  let subprocess: ReturnType<typeof createMockSubprocess>
  let onIdleShutdown: ReturnType<typeof vi.fn<() => void>>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'daemon-idle-shutdown-'))
    socketPath = getDaemonSocketPath(dir)
    tokenPath = join(dir, 'daemon.token')
    pidPath = getDaemonPidPath(dir)
    clock = new ManualIdleClock()
    subprocess = createMockSubprocess()
    onIdleShutdown = vi.fn<() => void>()
    server = null
  })

  afterEach(async () => {
    await server?.shutdown().catch(() => {})
    rmSync(dir, { recursive: true, force: true })
  })

  async function startServer(
    options: {
      launchNonce?: string
      protocolVersion?: number
    } = {}
  ): Promise<void> {
    server = new DaemonServer({
      socketPath,
      tokenPath,
      ...(options.launchNonce ? { pidPath, launchNonce: options.launchNonce } : {}),
      ...(options.protocolVersion !== undefined
        ? { protocolVersion: options.protocolVersion }
        : {}),
      idleShutdownTestConfig: { durationMs: 100, clock },
      onIdleShutdown,
      spawnSubprocess: () => subprocess
    })
    await server.start()
  }

  it('waits for the exact idle boundary and removes its owned artifacts', async () => {
    const launchNonce = 'launch-a'
    writeFileSync(
      pidPath,
      serializeDaemonPidFile({ pid: process.pid, startedAtMs: null, launchNonce })
    )
    await startServer({ launchNonce })

    clock.advanceBy(99)
    expect(onIdleShutdown).not.toHaveBeenCalled()
    expect(existsSync(tokenPath)).toBe(true)

    clock.advanceBy(1)
    await waitFor(() => onIdleShutdown.mock.calls.length === 1)

    expect(existsSync(tokenPath)).toBe(false)
    expect(existsSync(pidPath)).toBe(false)
    if (process.platform !== 'win32') {
      expect(existsSync(socketPath)).toBe(false)
    }
  })

  it('cancels on raw socket acceptance before authentication and rearms after close', async () => {
    await startServer()
    expect(clock.pendingCount).toBe(1)

    const rawSocket = connect(socketPath)
    await new Promise<void>((resolve) => rawSocket.once('connect', resolve))
    await waitFor(() => clock.pendingCount === 0)

    clock.advanceBy(1_000)
    expect(onIdleShutdown).not.toHaveBeenCalled()

    rawSocket.destroy()
    await waitFor(() => clock.pendingCount === 1)
    clock.advanceBy(100)
    await waitFor(() => onIdleShutdown.mock.calls.length === 1)
  })

  it('arms after the last authenticated client disconnects with no sessions', async () => {
    await startServer()
    const client = new DaemonClient({ socketPath, tokenPath })
    await client.ensureConnected()
    expect(clock.pendingCount).toBe(0)

    client.disconnect()
    await waitFor(() => clock.pendingCount === 1)
  })

  it('keeps a live session after clients disconnect, then arms on its exit', async () => {
    await startServer()
    const client = new DaemonClient({ socketPath, tokenPath })
    await client.ensureConnected()
    await client.request('createOrAttach', { sessionId: 'live', cols: 80, rows: 24 })
    client.disconnect()
    await waitFor(() => clock.pendingCount === 0)

    clock.advanceBy(1_000)
    expect(onIdleShutdown).not.toHaveBeenCalled()

    subprocess.exit(0)
    await waitFor(() => clock.pendingCount === 1)
    clock.advanceBy(100)
    await waitFor(() => onIdleShutdown.mock.calls.length === 1)
  })

  it('uses the direct-construction protocol fixture version for hello compatibility', async () => {
    await startServer({ protocolVersion: 22 })
    const client = new DaemonClient({ socketPath, tokenPath, protocolVersion: 22 })

    await expect(client.ensureConnected()).resolves.toBeUndefined()
    client.disconnect()
  })

  it('rejects create or attach once the idle admission fence is pending', async () => {
    await startServer()
    const daemon = server as unknown as {
      idleShutdownState: string
      routeRequest(clientId: string, request: unknown): Promise<unknown>
    }
    daemon.idleShutdownState = 'idle-shutdown-pending'

    await expect(
      daemon.routeRequest('late-client', {
        id: 'late-create',
        type: 'createOrAttach',
        payload: { sessionId: 'late', cols: 80, rows: 24 }
      })
    ).rejects.toThrow('temporarily unavailable; reconnect')
  })

  it('aborts the pending shutdown when create or attach started before the fence', async () => {
    await startServer()
    const daemon = server as unknown as {
      createOrAttachInFlight: number
      idleShutdownState: string
      beginIdleShutdown(): void
    }
    daemon.createOrAttachInFlight = 1

    daemon.beginIdleShutdown()

    expect(daemon.idleShutdownState).toBe('running')
    expect(onIdleShutdown).not.toHaveBeenCalled()
  })

  it('explicitly marks a post-fence accepted transport as retryable', async () => {
    await startServer()
    const daemon = server as unknown as {
      idleShutdownState: string
      handleConnection(socket: Socket): void
    }
    daemon.idleShutdownState = 'idle-shutdown-pending'
    const socket = new EventEmitter() as Socket
    socket.end = vi.fn() as unknown as Socket['end']

    daemon.handleConnection(socket)

    const payload = vi.mocked(socket.end).mock.calls[0]?.[0]
    expect(JSON.parse(String(payload))).toMatchObject({ ok: false, retryable: true })
    socket.emit('close')
  })

  it('preserves a replacement PID record during otherwise successful idle cleanup', async () => {
    writeFileSync(
      pidPath,
      serializeDaemonPidFile({ pid: process.pid, startedAtMs: null, launchNonce: 'replacement' })
    )
    await startServer({ launchNonce: 'mine' })

    clock.advanceBy(100)
    await waitFor(() => onIdleShutdown.mock.calls.length === 1)

    expect(JSON.parse(readFileSync(pidPath, 'utf8'))).toMatchObject({
      pid: process.pid,
      launchNonce: 'replacement'
    })
  })

  it('preserves a token file replaced before idle cleanup', async () => {
    await startServer()
    writeFileSync(tokenPath, 'replacement-token')

    clock.advanceBy(100)
    await waitFor(() => onIdleShutdown.mock.calls.length === 1)

    expect(readFileSync(tokenPath, 'utf8')).toBe('replacement-token')
  })
})

describe('daemon PID record ownership cleanup', () => {
  let dir: string
  let pidPath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'daemon-pid-ownership-'))
    pidPath = join(dir, 'daemon.pid')
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('unlinks only an exact PID and launch nonce match', () => {
    writeFileSync(
      pidPath,
      serializeDaemonPidFile({ pid: 123, startedAtMs: null, launchNonce: 'mine' })
    )

    expect(unlinkOwnedDaemonPidFile(pidPath, 123, 'mine')).toBe(true)
    expect(existsSync(pidPath)).toBe(false)
  })

  it.each([
    ['malformed', '{'],
    ['stale PID', serializeDaemonPidFile({ pid: 456, startedAtMs: null, launchNonce: 'mine' })],
    [
      'replacement nonce',
      serializeDaemonPidFile({ pid: 123, startedAtMs: null, launchNonce: 'new' })
    ]
  ])('preserves a %s record', (_label, contents) => {
    writeFileSync(pidPath, contents)

    expect(unlinkOwnedDaemonPidFile(pidPath, 123, 'mine')).toBe(false)
    expect(readFileSync(pidPath, 'utf8')).toBe(contents)
  })

  it('leaves a missing record missing', () => {
    expect(unlinkOwnedDaemonPidFile(pidPath, 123, 'mine')).toBe(false)
    expect(existsSync(pidPath)).toBe(false)
  })
})

/**
 * Repro for issue #7209 — "SSH host terminal size does not match the pane
 * (appears locked to host pane dimensions) on macOS".
 *
 * Root cause: the relay's `pty.attach` handler (src/relay/pty-handler.ts,
 * `attach()`) receives the attaching client's pane `cols`/`rows` — the desktop
 * SSH provider sends them explicitly on reattach (see
 * src/main/providers/ssh-pty-provider.ts spawn(): `pty.attach { cols, rows }`) —
 * but the handler NEVER calls `managed.pty.resize(cols, rows)`. So when a
 * desktop pane reattaches to an existing relay PTY (app restart, SSH reconnect,
 * or tab reveal), the remote PTY keeps whatever size it had when it was last
 * spawned/resized on the *previous* client — i.e. it stays pinned to the "host"
 * pane dimensions instead of adopting the local pane size.
 *
 * This test IMPORTS THE REAL relay PtyHandler (never reimplements it) and PINS
 * the buggy behavior: after spawning a PTY at 80x24 and attaching with the
 * (different) local pane size 200x50, the PTY's resize() is never invoked.
 *
 * The assertions below marked "BUG" encode the CURRENT (wrong) behavior. The
 * correct behavior — commented inline — is that attach should resize the PTY to
 * the attaching client's pane dimensions (200x50), mirroring the mobile /
 * remote-desktop "claim viewport" flow the issue references.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import * as ptyShellUtils from './pty-shell-utils'

const { mockPtySpawn, mockPtyInstance } = vi.hoisted(() => ({
  mockPtySpawn: vi.fn(),
  mockPtyInstance: {
    // Reuse the test runner's own (always-alive) pid so attach's liveness
    // probe treats the managed PTY as live.
    pid: process.pid,
    onData: vi.fn(),
    onExit: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    clear: vi.fn()
  }
}))

vi.mock('node-pty', () => ({
  spawn: mockPtySpawn
}))

import { PtyHandler } from './pty-handler'
import type { RelayDispatcher } from './dispatcher'

function createMockDispatcher() {
  const requestHandlers = new Map<
    string,
    (params: Record<string, unknown>, context?: { isStale: () => boolean }) => Promise<unknown>
  >()
  const notificationHandlers = new Map<string, (params: Record<string, unknown>) => void>()

  const dispatcher = {
    onRequest: vi.fn(
      (
        method: string,
        handler: (
          params: Record<string, unknown>,
          context?: { isStale: () => boolean }
        ) => Promise<unknown>
      ) => {
        requestHandlers.set(method, handler)
      }
    ),
    onNotification: vi.fn(
      (method: string, handler: (params: Record<string, unknown>) => void) => {
        notificationHandlers.set(method, handler)
      }
    ),
    notify: vi.fn(),
    async callRequest(method: string, params: Record<string, unknown> = {}) {
      const handler = requestHandlers.get(method)
      if (!handler) {
        throw new Error(`No handler for ${method}`)
      }
      return handler(params)
    },
    callNotification(method: string, params: Record<string, unknown> = {}) {
      const handler = notificationHandlers.get(method)
      if (!handler) {
        throw new Error(`No handler for ${method}`)
      }
      handler(params)
    }
  }

  return dispatcher
}

describe('repro #7209: SSH relay attach ignores the attaching client pane size', () => {
  let dispatcher: ReturnType<typeof createMockDispatcher>
  let handler: PtyHandler

  beforeEach(() => {
    vi.useFakeTimers()
    mockPtySpawn.mockReset()
    mockPtyInstance.onData.mockReset()
    mockPtyInstance.onExit.mockReset()
    mockPtyInstance.write.mockReset()
    mockPtyInstance.resize.mockReset()
    mockPtyInstance.kill.mockReset()
    mockPtyInstance.clear.mockReset()

    mockPtySpawn.mockReturnValue({ ...mockPtyInstance })

    dispatcher = createMockDispatcher()
    handler = new PtyHandler(dispatcher as unknown as RelayDispatcher)
  })

  afterEach(async () => {
    const cleanup = handler.dispose({ waitForPhysicalExit: false })
    await vi.runAllTimersAsync()
    await cleanup.catch(() => {})
    vi.useRealTimers()
  })

  it('drops the client cols/rows on reattach, pinning the remote PTY to its spawn (host) size', async () => {
    // 1. A first client spawns the SSH-host PTY at 80x24 (its pane size then).
    await dispatcher.callRequest('pty.spawn', { cols: 80, rows: 24 })
    expect(mockPtySpawn).toHaveBeenCalledTimes(1)
    // node-pty was created at the spawning client's dimensions.
    expect(mockPtySpawn.mock.calls[0][2]).toMatchObject({ cols: 80, rows: 24 })

    // resize() has not been touched yet.
    expect(mockPtyInstance.resize).not.toHaveBeenCalled()

    // 2. A desktop pane reattaches with a DIFFERENT local pane size (200x50).
    //    This is exactly what SshPtyProvider.spawn({ sessionId }) sends:
    //    pty.attach({ id, cols, rows, ... }).
    const aliveSpy = vi.spyOn(ptyShellUtils, 'isProcessAlive').mockReturnValue(true)
    try {
      await dispatcher.callRequest('pty.attach', {
        id: 'pty-1',
        cols: 200,
        rows: 50,
        suppressReplayNotification: true
      })
    } finally {
      aliveSpy.mockRestore()
    }

    // BUG (#7209): the relay ignored the attaching client's pane size — resize()
    // was never called, so the remote PTY stays at the original 80x24 "host"
    // dimensions and the terminal content does not match the local pane.
    //
    // CORRECT behavior would be:
    //   expect(mockPtyInstance.resize).toHaveBeenCalledWith(200, 50)
    // i.e. attach should claim the attaching client's viewport, the same way
    // the mobile / remote-desktop takeover flow resizes the shared PTY.
    expect(mockPtyInstance.resize).not.toHaveBeenCalled()
  })
})

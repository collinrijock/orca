import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _resetTerminalPaneRecoveryForTests,
  captureTerminalPaneRecoveryGeneration,
  requestTerminalPaneRecovery
} from './terminal-pane-recovery'

const mocks = vi.hoisted(() => ({
  remountTerminalTabForRecovery: vi.fn<(tabId: string) => boolean>(() => true),
  recordRendererCrashBreadcrumb: vi.fn(),
  hasPty: vi.fn<(id: string) => Promise<boolean | null>>(async () => true)
}))

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({
      remountTerminalTabForRecovery: mocks.remountTerminalTabForRecovery
    })
  }
}))

vi.mock('@/lib/crash-breadcrumb-recorder', () => ({
  recordRendererCrashBreadcrumb: mocks.recordRendererCrashBreadcrumb
}))

beforeEach(() => {
  _resetTerminalPaneRecoveryForTests()
  mocks.remountTerminalTabForRecovery.mockClear()
  mocks.remountTerminalTabForRecovery.mockReturnValue(true)
  mocks.recordRendererCrashBreadcrumb.mockClear()
  mocks.hasPty.mockClear()
  mocks.hasPty.mockResolvedValue(true)
  vi.stubGlobal('window', {
    api: { pty: { hasPty: mocks.hasPty } }
  })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('requestTerminalPaneRecovery', () => {
  it('remounts the tab and records a breadcrumb for a certified-dead pipeline', async () => {
    const result = await requestTerminalPaneRecovery({
      tabId: 'tab-1',
      ptyId: 'pty-1',
      reason: 'write-stalled'
    })

    expect(result).toBe(true)
    expect(mocks.remountTerminalTabForRecovery).toHaveBeenCalledWith('tab-1')
    expect(mocks.recordRendererCrashBreadcrumb).toHaveBeenCalledWith(
      'terminal_pane_recovery_remount',
      { tabId: 'tab-1', reason: 'write-stalled' }
    )
    // Pipeline-death reasons are already probe-certified — no liveness gate.
    expect(mocks.hasPty).not.toHaveBeenCalled()
  })

  it('records a breadcrumb when the tab cannot be remounted, without consuming budget', async () => {
    mocks.remountTerminalTabForRecovery.mockReturnValue(false)

    const result = await requestTerminalPaneRecovery({
      tabId: 'tab-gone',
      ptyId: 'pty-1',
      reason: 'restore-blocked'
    })

    expect(result).toBe(false)
    expect(mocks.recordRendererCrashBreadcrumb).toHaveBeenCalledWith(
      'terminal_pane_recovery_remount_unavailable',
      { tabId: 'tab-gone', reason: 'restore-blocked' }
    )
    // Budget untouched: a later request for the same tab may still remount.
    mocks.remountTerminalTabForRecovery.mockReturnValue(true)
    expect(
      await requestTerminalPaneRecovery({
        tabId: 'tab-gone',
        ptyId: 'pty-1',
        reason: 'restore-blocked'
      })
    ).toBe(true)
  })

  it('coalesces repeat requests inside the cooldown window', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)

    expect(
      await requestTerminalPaneRecovery({ tabId: 'tab-1', ptyId: 'pty-1', reason: 'write-stalled' })
    ).toBe(true)
    expect(
      await requestTerminalPaneRecovery({ tabId: 'tab-1', ptyId: 'pty-1', reason: 'replay-wedged' })
    ).toBe(false)
    expect(mocks.remountTerminalTabForRecovery).toHaveBeenCalledTimes(1)

    vi.setSystemTime(16_000)
    expect(
      await requestTerminalPaneRecovery({ tabId: 'tab-1', ptyId: 'pty-1', reason: 'replay-wedged' })
    ).toBe(true)
    expect(mocks.remountTerminalTabForRecovery).toHaveBeenCalledTimes(2)
  })

  it('caps recoveries per window to prevent remount storms', async () => {
    vi.useFakeTimers()
    for (let attempt = 0; attempt < 5; attempt += 1) {
      vi.setSystemTime(attempt * 20_000)
      await requestTerminalPaneRecovery({
        tabId: 'tab-1',
        ptyId: 'pty-1',
        reason: 'write-stalled'
      })
    }
    expect(mocks.remountTerminalTabForRecovery).toHaveBeenCalledTimes(3)
  })

  it('a window-cap decline schedules a retry that heals when the window reopens', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    for (let attempt = 0; attempt < 3; attempt += 1) {
      vi.setSystemTime(attempt * 20_000)
      await requestTerminalPaneRecovery({
        tabId: 'tab-1',
        ptyId: 'pty-1',
        reason: 'write-stalled'
      })
    }
    expect(mocks.remountTerminalTabForRecovery).toHaveBeenCalledTimes(3)

    // Cap-declined: without a retry this pane is a permanent zombie — its
    // certified-dead xterm no longer produces write signals to re-request.
    vi.setSystemTime(60_000)
    expect(
      await requestTerminalPaneRecovery({ tabId: 'tab-1', ptyId: 'pty-1', reason: 'write-stalled' })
    ).toBe(false)
    expect(
      await requestTerminalPaneRecovery({ tabId: 'tab-1', ptyId: 'pty-1', reason: 'replay-wedged' })
    ).toBe(false)
    expect(mocks.remountTerminalTabForRecovery).toHaveBeenCalledTimes(3)

    // One retry (deduped across the two declines) fires once the first
    // attempt ages out of the window, and remounts.
    await vi.advanceTimersByTimeAsync(250_000)
    expect(mocks.remountTerminalTabForRecovery).toHaveBeenCalledTimes(4)
    await vi.advanceTimersByTimeAsync(400_000)
    expect(mocks.remountTerminalTabForRecovery).toHaveBeenCalledTimes(4)
  })

  it('does not retry a cooldown decline from the xterm replaced by the remount', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const replacedGeneration = captureTerminalPaneRecoveryGeneration('tab-1')
    await requestTerminalPaneRecovery({
      tabId: 'tab-1',
      ptyId: 'pty-1',
      reason: 'write-stalled',
      terminalRecoveryGeneration: replacedGeneration
    })
    expect(
      await requestTerminalPaneRecovery({
        tabId: 'tab-1',
        ptyId: 'pty-1',
        reason: 'replay-wedged',
        terminalRecoveryGeneration: replacedGeneration
      })
    ).toBe(false)

    await vi.advanceTimersByTimeAsync(600_000)
    expect(mocks.remountTerminalTabForRecovery).toHaveBeenCalledTimes(1)
  })

  it('retries a fresh replacement xterm that wedges during the cooldown', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    await requestTerminalPaneRecovery({
      tabId: 'tab-1',
      ptyId: 'pty-1',
      reason: 'write-stalled',
      terminalRecoveryGeneration: captureTerminalPaneRecoveryGeneration('tab-1')
    })
    const replacementGeneration = captureTerminalPaneRecoveryGeneration('tab-1')

    expect(
      await requestTerminalPaneRecovery({
        tabId: 'tab-1',
        ptyId: 'pty-1',
        reason: 'replay-wedged',
        terminalRecoveryGeneration: replacementGeneration
      })
    ).toBe(false)
    await vi.advanceTimersByTimeAsync(14_999)
    expect(mocks.remountTerminalTabForRecovery).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(mocks.remountTerminalTabForRecovery).toHaveBeenCalledTimes(2)
  })

  it('does not let an awaited scheduled retry remount a newer generation', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    await requestTerminalPaneRecovery({
      tabId: 'tab-1',
      ptyId: 'pty-1',
      reason: 'write-stalled',
      terminalRecoveryGeneration: captureTerminalPaneRecoveryGeneration('tab-1')
    })
    const replacementGeneration = captureTerminalPaneRecoveryGeneration('tab-1')
    let resolveLiveness: ((live: boolean) => void) | undefined
    mocks.hasPty.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveLiveness = resolve
        })
    )
    await requestTerminalPaneRecovery({
      tabId: 'tab-1',
      ptyId: 'pty-1',
      reason: 'input-undeliverable',
      terminalRecoveryGeneration: replacementGeneration
    })

    await vi.advanceTimersByTimeAsync(15_000)
    expect(mocks.hasPty).toHaveBeenCalledTimes(1)
    expect(
      await requestTerminalPaneRecovery({
        tabId: 'tab-1',
        ptyId: 'pty-1',
        reason: 'write-stalled',
        terminalRecoveryGeneration: replacementGeneration
      })
    ).toBe(true)
    resolveLiveness?.(true)
    await Promise.resolve()

    expect(mocks.remountTerminalTabForRecovery).toHaveBeenCalledTimes(2)
  })

  it('budgets tabs independently', async () => {
    expect(
      await requestTerminalPaneRecovery({ tabId: 'tab-1', ptyId: 'pty-1', reason: 'write-stalled' })
    ).toBe(true)
    expect(
      await requestTerminalPaneRecovery({ tabId: 'tab-2', ptyId: 'pty-2', reason: 'write-stalled' })
    ).toBe(true)
    expect(mocks.remountTerminalTabForRecovery).toHaveBeenCalledTimes(2)
  })

  it('skips input-undeliverable recovery when the PTY is confirmed dead', async () => {
    mocks.hasPty.mockResolvedValue(false)

    const result = await requestTerminalPaneRecovery({
      tabId: 'tab-1',
      ptyId: 'pty-1',
      reason: 'input-undeliverable'
    })

    expect(result).toBe(false)
    expect(mocks.remountTerminalTabForRecovery).not.toHaveBeenCalled()
  })

  it('recovers input-undeliverable panes when the PTY is alive', async () => {
    const result = await requestTerminalPaneRecovery({
      tabId: 'tab-1',
      ptyId: 'pty-1',
      reason: 'input-undeliverable'
    })

    expect(result).toBe(true)
    expect(mocks.hasPty).toHaveBeenCalledWith('pty-1')
    expect(mocks.remountTerminalTabForRecovery).toHaveBeenCalledWith('tab-1')
  })

  it('proceeds when PTY liveness is unknown (probe threw)', async () => {
    mocks.hasPty.mockRejectedValue(new Error('ipc down'))

    const result = await requestTerminalPaneRecovery({
      tabId: 'tab-1',
      ptyId: 'pty-1',
      reason: 'input-undeliverable'
    })

    expect(result).toBe(true)
  })

  it('requires a ptyId for input-undeliverable recovery', async () => {
    const result = await requestTerminalPaneRecovery({
      tabId: 'tab-1',
      ptyId: null,
      reason: 'input-undeliverable'
    })

    expect(result).toBe(false)
    expect(mocks.remountTerminalTabForRecovery).not.toHaveBeenCalled()
  })

  it('requires authoritative liveness for remote panes (null hasPty blocks recovery)', async () => {
    mocks.hasPty.mockResolvedValue(null)

    const result = await requestTerminalPaneRecovery({
      tabId: 'tab-1',
      ptyId: 'remote:pty-1',
      reason: 'input-undeliverable',
      requireAuthoritativeLiveness: true
    })

    expect(result).toBe(false)
    expect(mocks.remountTerminalTabForRecovery).not.toHaveBeenCalled()
  })

  it('recovers a remote pane when liveness is authoritative true', async () => {
    mocks.hasPty.mockResolvedValue(true)

    const result = await requestTerminalPaneRecovery({
      tabId: 'tab-1',
      ptyId: 'remote:pty-1',
      reason: 'input-undeliverable',
      requireAuthoritativeLiveness: true
    })

    expect(result).toBe(true)
    expect(mocks.remountTerminalTabForRecovery).toHaveBeenCalledWith('tab-1')
  })

  it('blocks remote recovery when the liveness probe throws', async () => {
    mocks.hasPty.mockRejectedValue(new Error('runtime unreachable'))

    const result = await requestTerminalPaneRecovery({
      tabId: 'tab-1',
      ptyId: 'remote:pty-1',
      reason: 'input-undeliverable',
      requireAuthoritativeLiveness: true
    })

    expect(result).toBe(false)
    expect(mocks.remountTerminalTabForRecovery).not.toHaveBeenCalled()
  })

  it('never throws when the store surface is partial (timer/callback contexts)', async () => {
    // Regression: recovery fires from stall-watch timers and write callbacks;
    // an environment with a partial store (mocked suites, teardown races) must
    // get a false return, not an unhandled TypeError.
    mocks.remountTerminalTabForRecovery.mockImplementation(() => {
      throw new TypeError('remountTerminalTabForRecovery is not a function')
    })

    await expect(
      requestTerminalPaneRecovery({ tabId: 'tab-1', ptyId: 'pty-1', reason: 'write-stalled' })
    ).resolves.toBe(false)
    // The failure must leave a trace — it is the only forensic signal for a
    // production remount-failure loop (budget unconsumed → cooldown retries).
    expect(mocks.recordRendererCrashBreadcrumb).toHaveBeenCalledWith(
      'terminal_pane_recovery_failed',
      { tabId: 'tab-1', reason: 'write-stalled' }
    )
  })

  it('does not consume budget when the tab no longer exists', async () => {
    mocks.remountTerminalTabForRecovery.mockReturnValue(false)

    const result = await requestTerminalPaneRecovery({
      tabId: 'tab-gone',
      ptyId: 'pty-1',
      reason: 'write-stalled'
    })

    expect(result).toBe(false)
    // Not silent anymore: the missing-tab outcome is breadcrumbed (see the
    // dedicated test above), but no remount breadcrumb may fire.
    expect(mocks.recordRendererCrashBreadcrumb).not.toHaveBeenCalledWith(
      'terminal_pane_recovery_remount',
      expect.anything()
    )
  })
})

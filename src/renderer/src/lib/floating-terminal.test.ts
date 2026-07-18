import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  consumeFloatingTerminalOpenMaximizedIntent,
  requestFloatingTerminalOpenMaximized,
  shouldMountFloatingTerminalPanelForShell
} from './floating-terminal'

describe('floating terminal shell visibility', () => {
  it('does not mount an already-open panel over Landing', () => {
    expect(
      shouldMountFloatingTerminalPanelForShell({
        enabled: true,
        open: true,
        visibleTabCount: 1,
        landingActive: true
      })
    ).toBe(false)
  })

  it('remounts retained floating state inside a workspace', () => {
    expect(
      shouldMountFloatingTerminalPanelForShell({
        enabled: true,
        open: true,
        visibleTabCount: 1,
        landingActive: false
      })
    ).toBe(true)
  })
})

describe('floating terminal open-maximized intent', () => {
  afterEach(() => {
    vi.useRealTimers()
    // Drain any leftover intent so it cannot bleed into an unrelated test.
    consumeFloatingTerminalOpenMaximizedIntent()
  })

  it('returns true exactly once after a request', () => {
    requestFloatingTerminalOpenMaximized()

    expect(consumeFloatingTerminalOpenMaximizedIntent()).toBe(true)
    // One-shot: a second consume without a new request is false.
    expect(consumeFloatingTerminalOpenMaximizedIntent()).toBe(false)
  })

  it('returns false when no request was made', () => {
    expect(consumeFloatingTerminalOpenMaximizedIntent()).toBe(false)
  })

  it('expires a stale intent so an abandoned open does not leak into a later open', () => {
    vi.useFakeTimers()
    requestFloatingTerminalOpenMaximized()

    // Why: the open was abandoned (prevented/interrupted before the panel
    // mounted); a much-later ordinary open must not consume the stale intent.
    vi.advanceTimersByTime(2001)

    expect(consumeFloatingTerminalOpenMaximizedIntent()).toBe(false)
  })

  it('still honors an intent consumed within the same interaction window', () => {
    vi.useFakeTimers()
    requestFloatingTerminalOpenMaximized()

    vi.advanceTimersByTime(50)

    expect(consumeFloatingTerminalOpenMaximizedIntent()).toBe(true)
  })
})

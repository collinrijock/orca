import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderRateLimits } from '../../../../shared/rate-limit-types'
import { formatResetCountdown } from '../../../../shared/rate-limit-reset-format'

// Repro for issue #5399: "Limits always shows 5h regardless of reset time".
//
// The collapsed limits bar (InlineUsageBars) renders a STATIC "5h" label for the
// session window (StatusBar.tsx:987), while the expanded popover computes a live
// countdown from `resetsAt` (tooltip.tsx:284 -> formatResetCountdown). So when the
// real reset is e.g. 1h20m away, the collapsed bar still says "5h" and disagrees
// with the popover.

vi.mock('@/i18n/i18n', () => ({
  i18n: { language: 'en' },
  translate: (_key: string, fallback: string, values?: Record<string, string>) => {
    let result = fallback
    for (const [key, value] of Object.entries(values ?? {})) {
      result = result.replace(`{{${key}}}`, value)
    }
    return result
  }
}))

vi.mock('@/lib/agent-catalog', () => ({
  AgentIcon: () => null
}))

const mocks = vi.hoisted(() => ({
  usagePercentageDisplay: 'used' as 'used' | 'remaining'
}))

vi.mock('../../store', () => ({
  useAppStore: (selector: (state: { usagePercentageDisplay: 'used' | 'remaining' }) => unknown) =>
    selector({ usagePercentageDisplay: mocks.usagePercentageDisplay })
}))

// Session window that resets in 1h20m — NOT 5h — even though the window length is 5h.
// Small buffer so the floor-based formatter still reports 1h 20m after test-time
// elapses a few ms/seconds between snapshot and countdown computation.
const RESET_IN_MS = 80 * 60_000 + 5_000 // ~1h 20m

function claudeLimitsResettingSoon(): ProviderRateLimits {
  return {
    provider: 'claude',
    session: {
      usedPercent: 32,
      windowMinutes: 300,
      resetsAt: Date.now() + RESET_IN_MS,
      resetDescription: null
    },
    weekly: null,
    fableWeekly: null,
    updatedAt: Date.now(),
    error: null,
    status: 'ok'
  }
}

describe('repro #5399: collapsed limits bar ignores resetsAt', () => {
  beforeEach(() => {
    mocks.usagePercentageDisplay = 'used'
  })

  it('collapsed bar shows static "5h" while the popover countdown is "Resets in 1h 20m"', async () => {
    const { InlineUsageBars } = await import('./StatusBar')
    const limits = claudeLimitsResettingSoon()

    const markup = renderToStaticMarkup(<InlineUsageBars limits={limits} isFetching={false} />)

    // What the popover WOULD show for the same window (the correct, live value):
    const popoverCountdown = formatResetCountdown(limits.session!.resetsAt! - Date.now())
    expect(popoverCountdown).toBe('Resets in 1h 20m')

    // BUG (pinned): the collapsed bar renders the hardcoded "5h" label...
    expect(markup).toContain('32% used 5h')

    // ...and does NOT reflect the real 1h20m reset time shown in the popover.
    // CORRECT behavior would surface the reset time (e.g. "1h 20m") here too.
    expect(markup).not.toContain('1h 20m')
    expect(markup).not.toContain('1h20m')
  })
})

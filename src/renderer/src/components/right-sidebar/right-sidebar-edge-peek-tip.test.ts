import { describe, expect, it, vi } from 'vitest'
import {
  RIGHT_SIDEBAR_EDGE_PEEK_TIP_VISIBLE_MS,
  markRightSidebarEdgePeekTipDismissed,
  shouldShowRightSidebarEdgePeekTip
} from './right-sidebar-edge-peek-tip'

describe('shouldShowRightSidebarEdgePeekTip', () => {
  it('shows only when edge peek is enabled and the tip is not dismissed', () => {
    expect(shouldShowRightSidebarEdgePeekTip(null)).toBe(true)
    expect(
      shouldShowRightSidebarEdgePeekTip({
        rightSidebarEdgePeekEnabled: true,
        rightSidebarEdgePeekTipDismissed: false
      })
    ).toBe(true)
    expect(
      shouldShowRightSidebarEdgePeekTip({
        rightSidebarEdgePeekEnabled: false
      })
    ).toBe(false)
    expect(
      shouldShowRightSidebarEdgePeekTip({
        rightSidebarEdgePeekTipDismissed: true
      })
    ).toBe(false)
  })
})

describe('markRightSidebarEdgePeekTipDismissed', () => {
  it('persists the one-shot dismiss flag', () => {
    const updateSettings = vi.fn().mockResolvedValue(undefined)
    markRightSidebarEdgePeekTipDismissed({ updateSettings })
    expect(updateSettings).toHaveBeenCalledWith({ rightSidebarEdgePeekTipDismissed: true })
  })
})

describe('RIGHT_SIDEBAR_EDGE_PEEK_TIP_VISIBLE_MS', () => {
  it('stays brief (tooltip-length, not toast-length)', () => {
    expect(RIGHT_SIDEBAR_EDGE_PEEK_TIP_VISIBLE_MS).toBe(1000)
  })
})

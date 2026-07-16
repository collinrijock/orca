import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import {
  RIGHT_SIDEBAR_EDGE_PEEK_TIP_TOAST_ID,
  shouldShowRightSidebarEdgePeekTip,
  showRightSidebarEdgePeekTip
} from './right-sidebar-edge-peek-tip'

vi.mock('sonner', () => ({
  toast: {
    info: vi.fn(),
    dismiss: vi.fn()
  }
}))

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

describe('showRightSidebarEdgePeekTip', () => {
  beforeEach(() => {
    vi.mocked(toast.info).mockReset()
  })

  it('shows a dismissible info toast and persists dismiss on close', () => {
    const updateSettings = vi.fn().mockResolvedValue(undefined)
    showRightSidebarEdgePeekTip({ updateSettings })

    expect(toast.info).toHaveBeenCalledTimes(1)
    const [, options] = vi.mocked(toast.info).mock.calls[0] as [
      string,
      {
        id: string
        onDismiss?: () => void
        onAutoClose?: () => void
      }
    ]
    expect(options.id).toBe(RIGHT_SIDEBAR_EDGE_PEEK_TIP_TOAST_ID)

    options.onDismiss?.()
    expect(updateSettings).toHaveBeenCalledWith({ rightSidebarEdgePeekTipDismissed: true })
  })
})

// @vitest-environment happy-dom

import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { RightSidebarEdgePeekTipHost } from './right-sidebar-edge-peek-tip-host'
import { RIGHT_SIDEBAR_EDGE_PEEK_TIP_VISIBLE_MS } from './right-sidebar-edge-peek-tip'

const initialAppState = useAppStore.getInitialState()

beforeEach(() => {
  vi.useFakeTimers()
  cleanup()
  useAppStore.setState({
    ...initialAppState,
    rightSidebarOpen: true,
    rightSidebarPeek: false,
    settings: {
      rightSidebarEdgePeekEnabled: true,
      rightSidebarEdgePeekTipDismissed: false
    } as never,
    updateSettings: vi.fn().mockResolvedValue(undefined)
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  useAppStore.setState(initialAppState, true)
})

describe('RightSidebarEdgePeekTipHost', () => {
  it('shows a brief edge tip on the first open→closed transition', () => {
    const { rerender } = render(<RightSidebarEdgePeekTipHost />)
    expect(screen.queryByTestId('right-sidebar-edge-peek-tip')).toBeNull()

    act(() => {
      useAppStore.setState({ rightSidebarOpen: false })
    })
    rerender(<RightSidebarEdgePeekTipHost />)

    expect(screen.getByTestId('right-sidebar-edge-peek-tip').textContent).toContain(
      'Hover the right edge to peek'
    )
  })

  it('auto-hides after the visible duration and marks the tip dismissed', () => {
    const updateSettings = vi.fn().mockResolvedValue(undefined)
    useAppStore.setState({ updateSettings })
    const { rerender } = render(<RightSidebarEdgePeekTipHost />)

    act(() => {
      useAppStore.setState({ rightSidebarOpen: false })
    })
    rerender(<RightSidebarEdgePeekTipHost />)
    expect(screen.getByTestId('right-sidebar-edge-peek-tip')).toBeTruthy()

    act(() => {
      vi.advanceTimersByTime(RIGHT_SIDEBAR_EDGE_PEEK_TIP_VISIBLE_MS)
    })

    expect(screen.queryByTestId('right-sidebar-edge-peek-tip')).toBeNull()
    expect(updateSettings).toHaveBeenCalledWith({ rightSidebarEdgePeekTipDismissed: true })
  })

  it('does not show when the tip was already dismissed', () => {
    useAppStore.setState({
      settings: {
        rightSidebarEdgePeekEnabled: true,
        rightSidebarEdgePeekTipDismissed: true
      } as never
    })
    const { rerender } = render(<RightSidebarEdgePeekTipHost />)

    act(() => {
      useAppStore.setState({ rightSidebarOpen: false })
    })
    rerender(<RightSidebarEdgePeekTipHost />)

    expect(screen.queryByTestId('right-sidebar-edge-peek-tip')).toBeNull()
  })
})

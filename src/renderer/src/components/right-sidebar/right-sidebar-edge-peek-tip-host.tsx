import { useEffect, useRef, useState, type JSX } from 'react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import {
  RIGHT_SIDEBAR_EDGE_PEEK_TIP_VISIBLE_MS,
  markRightSidebarEdgePeekTipDismissed,
  shouldShowRightSidebarEdgePeekTip
} from './right-sidebar-edge-peek-tip'
import { isRightSidebarEdgePeekEnabled } from './right-sidebar-edge-peek-preference'

/**
 * One-shot tip: a quiet tooltip-style chip on the right edge after the first
 * close while peek is enabled. Auto-hides after ~1s. Successful peeks also mark
 * the tip seen.
 */
export function RightSidebarEdgePeekTipHost(): JSX.Element | null {
  const rightSidebarOpen = useAppStore((s) => s.rightSidebarOpen)
  const rightSidebarPeek = useAppStore((s) => s.rightSidebarPeek)
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const [visible, setVisible] = useState(false)
  // Why: only fire on a true open→closed transition, not on first mount when
  // the sidebar happens to start closed (no prior close gesture to teach from).
  const prevOpenRef = useRef(rightSidebarOpen)
  const hideTimerRef = useRef<number | null>(null)
  const updateSettingsRef = useRef(updateSettings)
  updateSettingsRef.current = updateSettings

  const clearHideTimer = (): void => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }

  useEffect(() => {
    return () => clearHideTimer()
  }, [])

  useEffect(() => {
    const wasOpen = prevOpenRef.current
    prevOpenRef.current = rightSidebarOpen
    if (!wasOpen || rightSidebarOpen) {
      return
    }
    if (!shouldShowRightSidebarEdgePeekTip(settings)) {
      return
    }
    setVisible(true)
    clearHideTimer()
    // Why: brief, non-blocking discoverability — a full toast is too heavy for
    // a one-shot edge gesture hint.
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null
      setVisible(false)
      markRightSidebarEdgePeekTipDismissed({ updateSettings: updateSettingsRef.current })
    }, RIGHT_SIDEBAR_EDGE_PEEK_TIP_VISIBLE_MS)
  }, [rightSidebarOpen, settings])

  useEffect(() => {
    // Why: if they discover the edge themselves, drop the tip so we never nag.
    if (!rightSidebarPeek) {
      return
    }
    if (!isRightSidebarEdgePeekEnabled(settings)) {
      return
    }
    clearHideTimer()
    setVisible(false)
    if (settings?.rightSidebarEdgePeekTipDismissed !== true) {
      markRightSidebarEdgePeekTipDismissed({ updateSettings: updateSettingsRef.current })
    }
  }, [rightSidebarPeek, settings])

  useEffect(() => {
    if (!isRightSidebarEdgePeekEnabled(settings) && visible) {
      clearHideTimer()
      setVisible(false)
    }
  }, [settings, visible])

  if (!visible) {
    return null
  }

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="right-sidebar-edge-peek-tip"
      // Why: fixed to the right edge mid-window so the hint points at the
      // gesture target (not the titlebar toggle the user just used).
      className="pointer-events-none fixed top-1/2 right-3 z-[90] -translate-y-1/2 animate-in fade-in-0 zoom-in-95 slide-in-from-right-2 duration-150 motion-reduce:animate-none"
    >
      <div className="relative rounded-md bg-foreground px-3 py-1.5 text-xs text-balance text-background shadow-xs">
        {translate(
          'auto.components.right.sidebar.edge.peek.tip.title',
          'Hover the right edge to peek'
        )}
        {/* Tooltip-style caret pointing at the window edge. */}
        <span
          aria-hidden
          className="absolute top-1/2 -right-1 size-2 -translate-y-1/2 rotate-45 rounded-[2px] bg-foreground"
        />
      </div>
    </div>
  )
}

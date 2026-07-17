import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type JSX } from 'react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import {
  RIGHT_SIDEBAR_EDGE_PEEK_TIP_VISIBLE_MS,
  markRightSidebarEdgePeekTipDismissed,
  shouldShowRightSidebarEdgePeekTip
} from './right-sidebar-edge-peek-tip'
import { isRightSidebarEdgePeekEnabled } from './right-sidebar-edge-peek-preference'

const TOGGLE_SELECTOR = '[data-right-sidebar-toggle]'

type AnchorRect = { top: number; left: number; width: number; height: number }

function measureToggleAnchor(): AnchorRect | null {
  const el = document.querySelector(TOGGLE_SELECTOR)
  if (!(el instanceof HTMLElement)) {
    return null
  }
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) {
    return null
  }
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
}

/**
 * One-shot tip anchored under the right-sidebar titlebar toggle after the first
 * close while peek is enabled. Auto-hides after ~1s. Successful peeks also mark
 * the tip seen.
 */
export function RightSidebarEdgePeekTipHost(): JSX.Element | null {
  const rightSidebarOpen = useAppStore((s) => s.rightSidebarOpen)
  const rightSidebarPeek = useAppStore((s) => s.rightSidebarPeek)
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const [visible, setVisible] = useState(false)
  const [anchor, setAnchor] = useState<AnchorRect | null>(null)
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

  // Why: measure after paint so the closed-state titlebar toggle has laid out;
  // re-measure on resize while the tip is up so a window drag doesn't leave it
  // floating off the icon.
  useLayoutEffect(() => {
    if (!visible) {
      setAnchor(null)
      return
    }
    const update = (): void => {
      setAnchor(measureToggleAnchor())
    }
    update()
    // Titlebar toggle mounts in the same close transition; retry once if the
    // first paint still has the open-sidebar control (which unmounts).
    const retry = window.setTimeout(update, 0)
    window.addEventListener('resize', update)
    return () => {
      window.clearTimeout(retry)
      window.removeEventListener('resize', update)
    }
  }, [visible, rightSidebarOpen])

  if (!visible || !anchor) {
    return null
  }

  // Why: hang left from the toggle so a near-edge titlebar icon doesn't clip
  // the tip off-screen; caret sits under the icon center.
  const caretOffsetPx = 14
  const style: CSSProperties = {
    position: 'fixed',
    top: anchor.top + anchor.height + 8,
    left: anchor.left + anchor.width / 2 + caretOffsetPx,
    transform: 'translateX(-100%)'
  }

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="right-sidebar-edge-peek-tip"
      style={style}
      className="pointer-events-none z-[90] w-max max-w-[240px] animate-in fade-in-0 zoom-in-95 slide-in-from-top-1 duration-150 motion-reduce:animate-none"
    >
      <div className="relative rounded-md bg-foreground px-3 py-1.5 text-xs leading-snug text-background shadow-xs">
        <div className="whitespace-nowrap">
          {translate(
            'auto.components.right.sidebar.edge.peek.tip.title',
            'Hover the right edge to peek'
          )}
        </div>
        <div className="whitespace-nowrap opacity-80">
          {translate(
            'auto.components.right.sidebar.edge.peek.tip.settings',
            'Turn this off in Settings'
          )}
        </div>
        {/* Tooltip-style caret pointing up at the toggle icon. */}
        <span
          aria-hidden
          className="absolute -top-1 size-2 rotate-45 rounded-[2px] bg-foreground"
          style={{ right: caretOffsetPx - 4 }}
        />
      </div>
    </div>
  )
}

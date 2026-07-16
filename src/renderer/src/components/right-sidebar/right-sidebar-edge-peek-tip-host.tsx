import { useEffect, useRef } from 'react'
import { useAppStore } from '@/store'
import {
  dismissRightSidebarEdgePeekTipToast,
  shouldShowRightSidebarEdgePeekTip,
  showRightSidebarEdgePeekTip
} from './right-sidebar-edge-peek-tip'
import { isRightSidebarEdgePeekEnabled } from './right-sidebar-edge-peek-preference'

/**
 * One-shot coachmark when the user first closes the right sidebar while edge
 * peek is enabled. Successful peeks also dismiss the tip (they already found
 * the gesture). Renders nothing.
 */
export function RightSidebarEdgePeekTipHost(): null {
  const rightSidebarOpen = useAppStore((s) => s.rightSidebarOpen)
  const rightSidebarPeek = useAppStore((s) => s.rightSidebarPeek)
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  // Why: only fire on a true open→closed transition, not on first mount when
  // the sidebar happens to start closed (no prior close gesture to teach from).
  const prevOpenRef = useRef(rightSidebarOpen)

  useEffect(() => {
    const wasOpen = prevOpenRef.current
    prevOpenRef.current = rightSidebarOpen
    if (!wasOpen || rightSidebarOpen) {
      return
    }
    if (!shouldShowRightSidebarEdgePeekTip(settings)) {
      return
    }
    showRightSidebarEdgePeekTip({ updateSettings })
  }, [rightSidebarOpen, settings, updateSettings])

  useEffect(() => {
    // Why: if they discover the edge themselves, mark the tip seen so we never
    // nag about a gesture they already use.
    if (!rightSidebarPeek || !isRightSidebarEdgePeekEnabled(settings)) {
      return
    }
    if (settings?.rightSidebarEdgePeekTipDismissed === true) {
      return
    }
    dismissRightSidebarEdgePeekTipToast()
    void Promise.resolve(updateSettings({ rightSidebarEdgePeekTipDismissed: true })).catch(() => {})
  }, [rightSidebarPeek, settings, updateSettings])

  useEffect(() => {
    if (!isRightSidebarEdgePeekEnabled(settings)) {
      dismissRightSidebarEdgePeekTipToast()
    }
  }, [settings])

  return null
}

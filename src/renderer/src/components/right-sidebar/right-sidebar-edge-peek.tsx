import React, { useEffect, useRef } from 'react'
import { useAppStore } from '@/store'
import { isRightSidebarEdgePeekEnabled } from './right-sidebar-edge-peek-preference'

// Arc-style edge peek: hovering the window's right edge while the sidebar is
// closed reveals it as a floating overlay instead of reflowing the editor.
// The enter delay keeps edge scrollbar grabs from flashing the sidebar open.
export const PEEK_OPEN_DELAY_MS = 250
export const PEEK_CLOSE_DELAY_MS = 300
// The rightmost band that arms the peek, and the top zone it excludes.
const PEEK_EDGE_TRIGGER_PX = 6
const PEEK_TITLEBAR_ZONE_PX = 36
const PEEK_INTERACTIVE_PORTAL_SELECTOR = [
  '[data-slot="context-menu-content"]',
  '[data-slot="context-menu-sub-content"]',
  '[data-slot="dropdown-menu-content"]',
  '[data-slot="dropdown-menu-sub-content"]',
  '[data-slot="hover-card-content"]',
  '[data-slot="popover-content"]',
  '[data-slot="select-content"]'
].join(',')

/**
 * Arms the edge peek while the sidebar is fully hidden. Detection is
 * geometry-based (a window mousemove comparing clientX against the right edge)
 * rather than an invisible DOM strip: a strip would swallow every mousedown in
 * the rightmost pixels, blocking scrollbar drags and clicks flush against the
 * window edge. Renders nothing.
 */
export function RightSidebarEdgePeekZone(): React.JSX.Element | null {
  const rightSidebarOpen = useAppStore((s) => s.rightSidebarOpen)
  const rightSidebarPeek = useAppStore((s) => s.rightSidebarPeek)
  const setRightSidebarPeek = useAppStore((s) => s.setRightSidebarPeek)
  const edgePeekEnabled = useAppStore((s) => isRightSidebarEdgePeekEnabled(s.settings))

  useEffect(() => {
    // Why: the zone unmounts when the active view loses sidebar controls; a
    // peek flag surviving that would render a ghost peek (no hover behind it)
    // when the user returns to a sidebar-capable view.
    return () => setRightSidebarPeek(false)
  }, [setRightSidebarPeek])

  useEffect(() => {
    // Why: an active peek must collapse immediately when the user turns the
    // setting off mid-gesture so the overlay doesn't stick without a dismiss
    // path that matches their preference.
    if (!edgePeekEnabled && rightSidebarPeek) {
      setRightSidebarPeek(false)
    }
  }, [edgePeekEnabled, rightSidebarPeek, setRightSidebarPeek])

  useEffect(() => {
    // The revealed overlay covers the edge, so arming is only needed while the
    // sidebar is fully hidden. Skipping the listener here also guarantees an
    // armed timer can't fire after the sidebar opens (the cleanup clears it).
    if (!edgePeekEnabled || rightSidebarOpen || rightSidebarPeek) {
      return
    }
    let openTimer: number | null = null
    const clearOpenTimer = (): void => {
      if (openTimer !== null) {
        window.clearTimeout(openTimer)
        openTimer = null
      }
    }
    const onMouseMove = (event: MouseEvent): void => {
      // Why: scrollbar and resize drags can remain in the edge band longer
      // than the hover delay; pressed buttons must never arm an overlay.
      if (event.buttons !== 0) {
        clearOpenTimer()
        return
      }
      // Why: exclude the top 36px titlebar row so the peek never arms over
      // window controls (Windows/Linux custom chrome).
      const inEdgeBand =
        event.clientY >= PEEK_TITLEBAR_ZONE_PX &&
        event.clientX >= window.innerWidth - PEEK_EDGE_TRIGGER_PX
      if (!inEdgeBand) {
        clearOpenTimer()
        return
      }
      if (openTimer === null) {
        openTimer = window.setTimeout(() => {
          openTimer = null
          setRightSidebarPeek(true)
        }, PEEK_OPEN_DELAY_MS)
      }
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mousedown', clearOpenTimer)
    window.addEventListener('blur', clearOpenTimer)
    document.documentElement.addEventListener('mouseleave', clearOpenTimer)
    return () => {
      clearOpenTimer()
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mousedown', clearOpenTimer)
      window.removeEventListener('blur', clearOpenTimer)
      document.documentElement.removeEventListener('mouseleave', clearOpenTimer)
    }
  }, [edgePeekEnabled, rightSidebarOpen, rightSidebarPeek, setRightSidebarPeek])

  return null
}

/**
 * Dismisses an active peek once the pointer moves left of the revealed
 * overlay. Dismissal is geometry-based (window mousemove) rather than
 * mouseleave-based: tooltips and menus portal outside the overlay element,
 * and a mouseleave dismiss would close the peek under an open popover.
 */
export function useRightSidebarEdgePeekDismiss(args: {
  isPeeking: boolean
  isResizing: boolean
  setPeek: (peek: boolean) => void
  overlayRef: React.RefObject<HTMLElement | null>
}): void {
  const { isPeeking, isResizing, setPeek, overlayRef } = args
  // Why: the dismiss watcher reads resize state inside window listeners; a ref
  // avoids re-subscribing them on every drag frame.
  const isResizingRef = useRef(isResizing)
  isResizingRef.current = isResizing

  useEffect(() => {
    if (!isPeeking) {
      return
    }
    let closeTimer: number | null = null
    let lastClientX: number | null = null
    // Why: measuring the overlay on every mousemove forces layout. Cache its
    // left edge and invalidate only when it can move (a resize drag or a window
    // resize), so the common per-frame move reads no geometry.
    let cachedOverlayLeft: number | null = null
    const invalidateOverlayLeft = (): void => {
      cachedOverlayLeft = null
    }
    const cancelClose = (): void => {
      if (closeTimer !== null) {
        window.clearTimeout(closeTimer)
        closeTimer = null
      }
    }
    const scheduleClose = (): void => {
      if (closeTimer === null) {
        closeTimer = window.setTimeout(() => {
          closeTimer = null
          // Why: the cached boundary may have been measured mid slide-in (the
          // entrance transform puts the rect near the window edge). Re-measure
          // and re-check here so a stale cache self-heals instead of
          // dismissing the peek under the cursor.
          const overlayLeft = overlayRef.current?.getBoundingClientRect().left ?? null
          cachedOverlayLeft = overlayLeft
          if (overlayLeft !== null && lastClientX !== null && lastClientX >= overlayLeft) {
            return
          }
          setPeek(false)
        }, PEEK_CLOSE_DELAY_MS)
      }
    }
    const onMouseMove = (event: MouseEvent): void => {
      lastClientX = event.clientX
      // A resize drag legitimately travels left of the overlay edge.
      if (isResizingRef.current) {
        invalidateOverlayLeft()
        cancelClose()
        return
      }
      if (cachedOverlayLeft === null) {
        cachedOverlayLeft = overlayRef.current?.getBoundingClientRect().left ?? null
      }
      if (cachedOverlayLeft === null || event.clientX >= cachedOverlayLeft) {
        cancelClose()
      } else if (
        // Why: only inspect the DOM after the cheap geometry check; Radix
        // portals can extend left but ordinary in-panel moves stay O(1).
        event.target instanceof Element &&
        event.target.closest(PEEK_INTERACTIVE_PORTAL_SELECTOR)
      ) {
        cancelClose()
      } else {
        scheduleClose()
      }
    }
    const dismissPeek = (): void => {
      cancelClose()
      setPeek(false)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('blur', dismissPeek)
    window.addEventListener('resize', invalidateOverlayLeft)
    document.documentElement.addEventListener('mouseleave', dismissPeek)
    return () => {
      cancelClose()
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('blur', dismissPeek)
      window.removeEventListener('resize', invalidateOverlayLeft)
      document.documentElement.removeEventListener('mouseleave', dismissPeek)
    }
  }, [isPeeking, overlayRef, setPeek])
}

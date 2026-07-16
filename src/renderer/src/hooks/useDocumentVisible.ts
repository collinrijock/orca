import { useEffect, useState } from 'react'
import { isWindowVisible } from '@/lib/window-visibility-interval'

/**
 * Track document visibility, event-driven via `visibilitychange` — no polling
 * interval and no animation-frame loop. Used to pause purely decorative motion
 * (working spinners) while the document is hidden and resume it on restore.
 */
export function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(isWindowVisible)

  useEffect(() => {
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') {
      return
    }
    const reconcile = (): void => setVisible(isWindowVisible())
    // Reconcile once in case visibility changed between initial state and here.
    reconcile()
    document.addEventListener('visibilitychange', reconcile)
    return () => document.removeEventListener('visibilitychange', reconcile)
  }, [])

  return visible
}

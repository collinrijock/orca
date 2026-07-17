import type { GlobalSettings } from '../../../../shared/types'
import {
  isRightSidebarEdgePeekEnabled,
  isRightSidebarEdgePeekTipDismissed
} from './right-sidebar-edge-peek-preference'

/** How long the one-shot edge-peek hint stays visible. */
export const RIGHT_SIDEBAR_EDGE_PEEK_TIP_VISIBLE_MS = 1000

type TipSettings = Pick<
  GlobalSettings,
  'rightSidebarEdgePeekEnabled' | 'rightSidebarEdgePeekTipDismissed'
> | null

export function shouldShowRightSidebarEdgePeekTip(settings: TipSettings): boolean {
  return isRightSidebarEdgePeekEnabled(settings) && !isRightSidebarEdgePeekTipDismissed(settings)
}

export function markRightSidebarEdgePeekTipDismissed(args: {
  updateSettings: (updates: Partial<GlobalSettings>) => Promise<void> | void
}): void {
  void Promise.resolve(args.updateSettings({ rightSidebarEdgePeekTipDismissed: true })).catch(
    () => {}
  )
}

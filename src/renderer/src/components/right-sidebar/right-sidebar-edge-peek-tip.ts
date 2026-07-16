import { toast } from 'sonner'
import type { GlobalSettings } from '../../../../shared/types'
import { translate } from '@/i18n/i18n'
import {
  isRightSidebarEdgePeekEnabled,
  isRightSidebarEdgePeekTipDismissed
} from './right-sidebar-edge-peek-preference'

export const RIGHT_SIDEBAR_EDGE_PEEK_TIP_TOAST_ID = 'right-sidebar-edge-peek-tip'

type TipSettings = Pick<
  GlobalSettings,
  'rightSidebarEdgePeekEnabled' | 'rightSidebarEdgePeekTipDismissed'
> | null

export function shouldShowRightSidebarEdgePeekTip(settings: TipSettings): boolean {
  return isRightSidebarEdgePeekEnabled(settings) && !isRightSidebarEdgePeekTipDismissed(settings)
}

export function showRightSidebarEdgePeekTip(args: {
  updateSettings: (updates: Partial<GlobalSettings>) => Promise<void> | void
}): void {
  const dismissTip = (): void => {
    void Promise.resolve(args.updateSettings({ rightSidebarEdgePeekTipDismissed: true })).catch(
      () => {}
    )
  }

  // Why: one-shot discoverability for an invisible edge gesture; long enough
  // to read but not sticky like opt-in setting suggestions.
  toast.info(
    translate('auto.components.right.sidebar.edge.peek.tip.title', 'Hover the right edge to peek'),
    {
      id: RIGHT_SIDEBAR_EDGE_PEEK_TIP_TOAST_ID,
      description: translate(
        'auto.components.right.sidebar.edge.peek.tip.description',
        'The right sidebar slides over the editor without reflowing it. Click the toggle or use the shortcut to pin it open. Change this anytime in Settings › Appearance.'
      ),
      duration: 10_000,
      dismissible: true,
      onDismiss: dismissTip,
      onAutoClose: dismissTip
    }
  )
}

export function dismissRightSidebarEdgePeekTipToast(): void {
  toast.dismiss(RIGHT_SIDEBAR_EDGE_PEEK_TIP_TOAST_ID)
}

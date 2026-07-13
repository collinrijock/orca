import type { TuiAgent } from '../../../../shared/types'

export function nativeChatLaunchAgentForLeaf(args: {
  launchAgent?: TuiAgent | null
  launchAgentLeafId: string | null
  leafId: string | null
  leafIds: readonly string[]
}): TuiAgent | null {
  const { launchAgent, launchAgentLeafId, leafId, leafIds } = args
  if (!launchAgent || !launchAgentLeafId || !leafId) {
    return null
  }
  // Why: launchAgent belongs to the tab's original pane. Once a split exists,
  // it is not evidence that an agent is running in any particular sibling.
  return leafIds.length === 1 && leafIds[0] === leafId && launchAgentLeafId === leafId
    ? launchAgent
    : null
}

export type NativeChatLeafRoute = {
  chatLeafId: string | null
  exitChat: boolean
}

export function resolveNativeChatLeafRoute(args: {
  isChatViewMode: boolean
  chatLeafId: string | null
  activeLeafId: string | null
  chatLeafStillMounted: boolean
  chatLeafIsEligible: boolean
  activeLeafIsEligible: boolean
}): NativeChatLeafRoute {
  if (!args.isChatViewMode) {
    return { chatLeafId: null, exitChat: false }
  }
  if (args.chatLeafId && args.chatLeafStillMounted && args.chatLeafIsEligible) {
    return { chatLeafId: args.chatLeafId, exitChat: false }
  }
  // Manager hydration can briefly have no active pane; preserve the requested
  // mode until a concrete leaf exists instead of toggling it off during mount.
  if (!args.activeLeafId) {
    return { chatLeafId: args.chatLeafId, exitChat: false }
  }
  if (args.activeLeafIsEligible) {
    return { chatLeafId: args.activeLeafId, exitChat: false }
  }
  // Why: closing or invalidating the chat-owning leaf must not move its composer
  // onto a plain-shell sibling. Return the tab to terminal mode instead.
  return { chatLeafId: null, exitChat: true }
}

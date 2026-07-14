import { useAppStore } from '@/store'
import type { TerminalTabCloseReason } from '@/store/slices/terminal-tab-retirement'

export function closeLocalTerminalTabState(
  terminalTabId: string,
  options?: { reason?: TerminalTabCloseReason; remoteCloseOwnedByHost?: boolean }
): void {
  const state = useAppStore.getState()
  if (
    Object.values(state.tabsByWorktree).some((tabs) => tabs.some((tab) => tab.id === terminalTabId))
  ) {
    if (options?.reason || options?.remoteCloseOwnedByHost) {
      state.closeTab(terminalTabId, options)
    } else {
      state.closeTab(terminalTabId)
    }
    return
  }

  for (const tabs of Object.values(state.unifiedTabsByWorktree ?? {})) {
    const unified = tabs.find(
      (tab) =>
        tab.contentType === 'terminal' &&
        (tab.entityId === terminalTabId || tab.id === terminalTabId)
    )
    if (unified) {
      state.closeUnifiedTab(unified.id)
      return
    }
  }
}

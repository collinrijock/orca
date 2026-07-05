import { isFreshNonDoneAgentStatus, type AgentStatusEntry } from '../agent-status-types'
import { parseLegacyNumericPaneKey, parsePaneKey } from '../stable-pane-id'
import type { TerminalTab } from '../types'

type TerminalLikeTab = Pick<TerminalTab, 'id'>
type BrowserLikeTab = { id: string }

type TabsByWorktree = Record<string, readonly TerminalLikeTab[]>
export type LiveAgentWorktreeStatus = 'working' | 'permission'

export function tabHasLivePty(ptyIdsByTabId: Record<string, string[]>, tabId: string): boolean {
  return (ptyIdsByTabId[tabId]?.length ?? 0) > 0
}

function agentStatusTabId(paneKey: string | undefined): string | null {
  if (!paneKey) {
    return null
  }
  return parsePaneKey(paneKey)?.tabId ?? parseLegacyNumericPaneKey(paneKey)?.tabId ?? null
}

function resolveAgentStatusWorktreeId(
  entry: AgentStatusEntry,
  worktreeIdByTabId: ReadonlyMap<string, string>
): string | null {
  return (
    worktreeIdByTabId.get(agentStatusTabId(entry.paneKey) ?? '') ??
    entry.worktreeId ??
    worktreeIdByTabId.get(agentStatusTabId(entry.orchestration?.parentPaneKey) ?? '') ??
    null
  )
}

export function getWorktreeIdsWithLiveAgent(
  agentStatusByPaneKey: Record<string, AgentStatusEntry> | null | undefined,
  tabsByWorktree: TabsByWorktree | null | undefined,
  now: number
): Set<string> {
  return new Set(getLiveAgentStatusByWorktreeId(agentStatusByPaneKey, tabsByWorktree, now).keys())
}

export function getLiveAgentStatusByWorktreeId(
  agentStatusByPaneKey: Record<string, AgentStatusEntry> | null | undefined,
  tabsByWorktree: TabsByWorktree | null | undefined,
  now: number
): Map<string, LiveAgentWorktreeStatus> {
  const worktreeIdByTabId = new Map<string, string>()
  for (const [worktreeId, tabs] of Object.entries(tabsByWorktree ?? {})) {
    for (const tab of tabs) {
      worktreeIdByTabId.set(tab.id, worktreeId)
    }
  }
  const result = new Map<string, LiveAgentWorktreeStatus>()
  for (const entry of Object.values(agentStatusByPaneKey ?? {})) {
    if (!isFreshNonDoneAgentStatus(entry, now)) {
      continue
    }
    const worktreeId = resolveAgentStatusWorktreeId(entry, worktreeIdByTabId)
    if (!worktreeId) {
      continue
    }
    const status = entry.state === 'working' ? 'working' : 'permission'
    if (status === 'permission' || !result.has(worktreeId)) {
      result.set(worktreeId, status)
    }
  }
  return result
}

export function hasActiveWorkspaceActivity(
  worktreeId: string,
  tabsByWorktree: Record<string, readonly TerminalLikeTab[]> | null | undefined,
  ptyIdsByTabId: Record<string, string[]> | null | undefined,
  browserTabsByWorktree: Record<string, readonly BrowserLikeTab[]> | null | undefined,
  worktreeIdsWithLiveAgent: ReadonlySet<string>
): boolean {
  const tabs = tabsByWorktree?.[worktreeId] ?? []
  const hasLiveTerminal =
    ptyIdsByTabId != null && tabs.some((tab) => tabHasLivePty(ptyIdsByTabId, tab.id))
  const hasBrowser = (browserTabsByWorktree?.[worktreeId] ?? []).length > 0
  // Why: a running agent keeps the workspace visible through transient PTY
  // gaps such as an SSH reconnect or an unmounted remote pane.
  return hasLiveTerminal || hasBrowser || worktreeIdsWithLiveAgent.has(worktreeId)
}

export function isInactiveWorkspace(
  worktreeId: string,
  tabsByWorktree: Record<string, readonly TerminalLikeTab[]> | null | undefined,
  ptyIdsByTabId: Record<string, string[]> | null | undefined,
  browserTabsByWorktree: Record<string, readonly BrowserLikeTab[]> | null | undefined,
  worktreeIdsWithLiveAgent: ReadonlySet<string>
): boolean {
  return !hasActiveWorkspaceActivity(
    worktreeId,
    tabsByWorktree,
    ptyIdsByTabId,
    browserTabsByWorktree,
    worktreeIdsWithLiveAgent
  )
}

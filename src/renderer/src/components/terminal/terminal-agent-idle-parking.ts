import type {
  AgentStatusEntry,
  AgentStatusState,
  MigrationUnsupportedPtyEntry
} from '../../../../shared/agent-status-types'
import { parseLegacyNumericPaneKey, parsePaneKey } from '../../../../shared/stable-pane-id'
import type { TerminalTab } from '../../../../shared/types'
import type { TerminalWorktreeAgentActivity } from './terminal-worktree-parking'

type TerminalAgentIdleParkingState = {
  tabsByWorktree: Record<string, readonly Pick<TerminalTab, 'id'>[]>
  agentStatusByPaneKey: Record<string, Pick<AgentStatusEntry, 'state' | 'worktreeId'>>
  migrationUnsupportedByPtyId: Record<
    string,
    Pick<MigrationUnsupportedPtyEntry, 'paneKey' | 'worktreeId'>
  >
  retainedAgentsByPaneKey: Record<string, { worktreeId: string }>
}

function tabIdFromPaneKey(paneKey: string): string | null {
  const parsed = parsePaneKey(paneKey)
  if (parsed) {
    return parsed.tabId
  }
  return parseLegacyNumericPaneKey(paneKey)?.tabId ?? null
}

function getWorktreeIdForPane(
  paneKey: string,
  tabIdToWorktreeId: ReadonlyMap<string, string>
): string | null {
  const tabId = tabIdFromPaneKey(paneKey)
  return tabId ? (tabIdToWorktreeId.get(tabId) ?? null) : null
}

function getSummary(
  summaries: Map<string, TerminalWorktreeAgentActivity>,
  worktreeId: string
): TerminalWorktreeAgentActivity {
  let summary = summaries.get(worktreeId)
  if (!summary) {
    summary = { hasCompletedAgent: false, hasActiveAgent: false }
    summaries.set(worktreeId, summary)
  }
  return summary
}

function applyLiveState(summary: TerminalWorktreeAgentActivity, state: AgentStatusState): void {
  if (state === 'done') {
    summary.hasCompletedAgent = true
  } else {
    summary.hasActiveAgent = true
  }
}

export function summarizeTerminalAgentIdleParking(
  state: TerminalAgentIdleParkingState
): Map<string, TerminalWorktreeAgentActivity> {
  const tabIdToWorktreeId = new Map<string, string>()
  for (const [worktreeId, tabs] of Object.entries(state.tabsByWorktree)) {
    for (const tab of tabs) {
      tabIdToWorktreeId.set(tab.id, worktreeId)
    }
  }

  const summaries = new Map<string, TerminalWorktreeAgentActivity>()
  for (const [paneKey, entry] of Object.entries(state.agentStatusByPaneKey)) {
    const worktreeId = getWorktreeIdForPane(paneKey, tabIdToWorktreeId) ?? entry.worktreeId
    if (!worktreeId) {
      continue
    }
    applyLiveState(getSummary(summaries, worktreeId), entry.state)
  }

  for (const unsupported of Object.values(state.migrationUnsupportedByPtyId)) {
    const worktreeId =
      (unsupported.paneKey ? getWorktreeIdForPane(unsupported.paneKey, tabIdToWorktreeId) : null) ??
      unsupported.worktreeId
    if (worktreeId) {
      getSummary(summaries, worktreeId).hasActiveAgent = true
    }
  }

  for (const retained of Object.values(state.retainedAgentsByPaneKey)) {
    getSummary(summaries, retained.worktreeId).hasCompletedAgent = true
  }

  return summaries
}

export function terminalAgentIdleParkingSummariesEqual(
  left: ReadonlyMap<string, TerminalWorktreeAgentActivity>,
  right: ReadonlyMap<string, TerminalWorktreeAgentActivity>
): boolean {
  if (left.size !== right.size) {
    return false
  }
  for (const [worktreeId, leftSummary] of left) {
    const rightSummary = right.get(worktreeId)
    if (
      !rightSummary ||
      leftSummary.hasActiveAgent !== rightSummary.hasActiveAgent ||
      leftSummary.hasCompletedAgent !== rightSummary.hasCompletedAgent
    ) {
      return false
    }
  }
  return true
}

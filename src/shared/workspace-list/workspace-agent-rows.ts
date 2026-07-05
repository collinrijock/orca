import {
  AGENT_STATUS_STALE_AFTER_MS,
  type AgentStatusEntry,
  type AgentStatusOrchestrationContext
} from '../agent-status-types'
import { parsePaneKey } from '../stable-pane-id'
import type { TerminalLayoutSnapshot, TerminalTab } from '../types'
import { isExplicitAgentStatusFresh } from './workspace-agent-status-freshness'
import { applyWorkspaceAgentRowLineage } from './workspace-agent-lineage'
import { compareWorkspaceAgentRows } from './workspace-agent-row-order'
import type { WorkspaceAgentRow, WorkspaceRetainedAgentEntry } from './workspace-list-model'
import {
  effectiveWorkspaceAgentRowStartedAt,
  entryWithRuntimeOrchestration,
  tabFromWorktreeAttributedStatusEntry
} from './workspace-agent-entry-projection'
import {
  isRetainedLegacyAliasOfSeenStablePane,
  markCompletedWorkerParentPaneKeysSeen
} from './workspace-agent-pane-identity'
import { resolveRowAgentType } from './workspace-agent-type-resolution'
import { buildTitleDerivedAgentRows } from './workspace-title-agent-rows'

export { resolveAgentTypeFromTerminalTitle } from './workspace-agent-type-resolution'

export function buildWorkspaceAgentRows(args: {
  tabs: TerminalTab[]
  entries: AgentStatusEntry[]
  retained: WorkspaceRetainedAgentEntry[]
  runtimePaneTitlesByTabId?: Record<string, Record<number, string>>
  ptyIdsByTabId?: Record<string, string[]>
  terminalLayoutsByTabId?: Record<string, TerminalLayoutSnapshot | undefined>
  runtimeAgentOrchestrationByPaneKey?: Record<string, AgentStatusOrchestrationContext>
  now: number
  applyLineage?: boolean
}): WorkspaceAgentRow[] {
  const rows: WorkspaceAgentRow[] = []
  const seenPaneKeys = new Set<string>()
  const currentTabIds = new Set(args.tabs.map((tab) => tab.id))

  const entriesByTabId = new Map<string, AgentStatusEntry[]>()
  for (const entry of args.entries) {
    const parsed = parsePaneKey(entry.paneKey)
    if (!parsed) {
      continue
    }
    const bucket = entriesByTabId.get(parsed.tabId)
    if (bucket) {
      bucket.push(entry)
    } else {
      entriesByTabId.set(parsed.tabId, [entry])
    }
  }

  for (const tab of args.tabs) {
    const explicitEntries = entriesByTabId.get(tab.id) ?? []
    for (const entry of explicitEntries) {
      const rowEntry = entryWithRuntimeOrchestration(entry, args.runtimeAgentOrchestrationByPaneKey)
      const isFresh = isExplicitAgentStatusFresh(rowEntry, args.now, AGENT_STATUS_STALE_AFTER_MS)
      const shouldDecay =
        !isFresh &&
        (rowEntry.state === 'working' ||
          rowEntry.state === 'blocked' ||
          rowEntry.state === 'waiting')
      const startedAt = effectiveWorkspaceAgentRowStartedAt(rowEntry)
      rows.push({
        paneKey: rowEntry.paneKey,
        entry: rowEntry,
        tab,
        agentType: resolveRowAgentType(rowEntry, tab),
        rowSource: 'live',
        state: shouldDecay ? 'idle' : rowEntry.state,
        startedAt
      })
      seenPaneKeys.add(rowEntry.paneKey)
    }
  }

  markCompletedWorkerParentPaneKeysSeen({
    entries: args.entries,
    retained: args.retained,
    runtimeAgentOrchestrationByPaneKey: args.runtimeAgentOrchestrationByPaneKey,
    terminalLayoutsByTabId: args.terminalLayoutsByTabId,
    currentTabIds,
    seenPaneKeys
  })

  rows.push(...buildTitleDerivedAgentRows({ ...args, seenPaneKeys }))

  for (const entry of args.entries) {
    if (seenPaneKeys.has(entry.paneKey)) {
      continue
    }
    const rowEntry = entryWithRuntimeOrchestration(entry, args.runtimeAgentOrchestrationByPaneKey)
    const startedAt = effectiveWorkspaceAgentRowStartedAt(rowEntry)
    const tab = tabFromWorktreeAttributedStatusEntry(rowEntry, startedAt)
    if (!tab) {
      continue
    }
    const isFresh = isExplicitAgentStatusFresh(rowEntry, args.now, AGENT_STATUS_STALE_AFTER_MS)
    const shouldDecay =
      !isFresh &&
      (rowEntry.state === 'working' || rowEntry.state === 'blocked' || rowEntry.state === 'waiting')
    rows.push({
      paneKey: rowEntry.paneKey,
      entry: rowEntry,
      tab,
      agentType: resolveRowAgentType(rowEntry, tab),
      rowSource: 'live',
      state: shouldDecay ? 'idle' : rowEntry.state,
      startedAt
    })
    seenPaneKeys.add(rowEntry.paneKey)
  }

  for (const retained of args.retained) {
    if (seenPaneKeys.has(retained.entry.paneKey)) {
      continue
    }
    if (
      isRetainedLegacyAliasOfSeenStablePane({
        paneKey: retained.entry.paneKey,
        terminalLayoutsByTabId: args.terminalLayoutsByTabId,
        seenPaneKeys
      })
    ) {
      continue
    }
    const rowEntry = entryWithRuntimeOrchestration(
      retained.entry,
      args.runtimeAgentOrchestrationByPaneKey
    )
    rows.push({
      paneKey: rowEntry.paneKey,
      entry: rowEntry,
      tab: retained.tab,
      agentType: resolveRowAgentType(rowEntry, retained.tab),
      rowSource: 'retained',
      state: 'done',
      startedAt: retained.startedAt
    })
  }

  rows.sort(compareWorkspaceAgentRows)
  return args.applyLineage === false ? rows : applyWorkspaceAgentRowLineage(rows)
}

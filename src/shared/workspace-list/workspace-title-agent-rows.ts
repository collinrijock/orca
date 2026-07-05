import {
  detectAgentStatusFromTitle,
  getAgentLabel,
  isClaudeManagementTitle
} from '../agent-detection'
import { normalizeCompatibleAgentTitleForOwner } from '../agent-title-owner'
import type { AgentStatusOrchestrationContext, AgentStatusState } from '../agent-status-types'
import { isTerminalLeafId, makePaneKey } from '../stable-pane-id'
import type { TerminalLayoutSnapshot, TerminalPaneLayoutNode, TerminalTab } from '../types'
import type { WorkspaceAgentRow } from './workspace-list-model'
import { resolveTitleDerivedAgentType } from './workspace-agent-type-resolution'
import { tabHasLivePty } from './workspace-terminal-liveness'

function collectLeafIds(node: TerminalPaneLayoutNode | null): string[] {
  if (!node) {
    return []
  }
  if (node.type === 'leaf') {
    return [node.leafId]
  }
  return [...collectLeafIds(node.first), ...collectLeafIds(node.second)]
}

function resolveLeafIdForTitleFallback(args: {
  layout: TerminalLayoutSnapshot | undefined
  paneTitleEntries: [string, string][]
  paneId: number
  title: string
}): string | null {
  const matchingTitleLeafIds = Object.entries(args.layout?.titlesByLeafId ?? {})
    .filter(([, title]) => title === args.title)
    .map(([leafId]) => leafId)
  if (matchingTitleLeafIds.length === 1) {
    return matchingTitleLeafIds[0]
  }

  const leafIds = collectLeafIds(args.layout?.root ?? null)
  if (leafIds.length === 1) {
    return leafIds[0]
  }

  const paneIndex = args.paneTitleEntries.findIndex(([paneId]) => Number(paneId) === args.paneId)
  return paneIndex >= 0 ? (leafIds[paneIndex] ?? null) : null
}

function titleStatusToRowState(
  status: 'working' | 'permission' | 'idle'
): AgentStatusState | 'idle' {
  if (status === 'permission') {
    return 'waiting'
  }
  if (status === 'working') {
    return 'working'
  }
  return 'idle'
}

function buildTitleDerivedAgentRow(args: {
  tab: TerminalTab
  leafId: string
  title: string
  now: number
  runtimeAgentOrchestrationByPaneKey?: Record<string, AgentStatusOrchestrationContext>
}): WorkspaceAgentRow | null {
  const title = normalizeCompatibleAgentTitleForOwner(args.title, args.tab.launchAgent)
  const isClaudeAgentsTitle = isClaudeManagementTitle(title)
  const status = isClaudeAgentsTitle ? 'idle' : detectAgentStatusFromTitle(title)
  const label = isClaudeAgentsTitle ? 'Claude Code' : getAgentLabel(title)
  if (!status || !label || !isTerminalLeafId(args.leafId)) {
    return null
  }
  const paneKey = makePaneKey(args.tab.id, args.leafId)
  const orchestration = args.runtimeAgentOrchestrationByPaneKey?.[paneKey]
  const agentType = isClaudeAgentsTitle ? 'claude' : resolveTitleDerivedAgentType(title, label)
  if (!agentType) {
    return null
  }
  const rowState = titleStatusToRowState(status)
  const secondary =
    status === 'permission' ? 'Needs input' : status === 'working' ? 'Running' : 'Idle'
  const entryState: AgentStatusState = rowState === 'waiting' ? 'waiting' : 'working'
  return {
    paneKey,
    entry: {
      paneKey,
      state: entryState,
      prompt: label,
      updatedAt: args.now,
      stateStartedAt: args.now,
      stateHistory: [],
      agentType,
      terminalTitle: title,
      lastAssistantMessage: secondary,
      ...(orchestration ? { orchestration } : {})
    },
    tab: args.tab,
    agentType,
    rowSource: 'live',
    state: rowState,
    startedAt: 0
  }
}

export function buildTitleDerivedAgentRows(args: {
  tabs: TerminalTab[]
  runtimePaneTitlesByTabId?: Record<string, Record<number, string>>
  ptyIdsByTabId?: Record<string, string[]>
  terminalLayoutsByTabId?: Record<string, TerminalLayoutSnapshot | undefined>
  runtimeAgentOrchestrationByPaneKey?: Record<string, AgentStatusOrchestrationContext>
  seenPaneKeys: Set<string>
  now: number
}): WorkspaceAgentRow[] {
  const rows: WorkspaceAgentRow[] = []
  const runtimePaneTitlesByTabId = args.runtimePaneTitlesByTabId ?? {}
  const ptyIdsByTabId = args.ptyIdsByTabId ?? {}
  const terminalLayoutsByTabId = args.terminalLayoutsByTabId ?? {}

  for (const tab of args.tabs) {
    if (!tabHasLivePty(ptyIdsByTabId, tab.id)) {
      continue
    }
    const layout = terminalLayoutsByTabId[tab.id]
    const paneTitles = runtimePaneTitlesByTabId[tab.id]
    const paneTitleEntries =
      paneTitles && Object.keys(paneTitles).length > 0
        ? Object.entries(paneTitles).sort(([a], [b]) => Number(a) - Number(b))
        : []

    if (paneTitleEntries.length > 0) {
      for (const [paneId, title] of paneTitleEntries) {
        const leafId = resolveLeafIdForTitleFallback({
          layout,
          paneTitleEntries,
          paneId: Number(paneId),
          title
        })
        if (leafId) {
          appendTitleRow({ ...args, rows, tab, leafId, title })
        }
      }
      continue
    }

    const leafId = layout?.activeLeafId ?? collectLeafIds(layout?.root ?? null)[0]
    if (leafId) {
      appendTitleRow({ ...args, rows, tab, leafId, title: tab.title })
    }
  }

  return rows
}

function appendTitleRow(
  args: Parameters<typeof buildTitleDerivedAgentRows>[0] & {
    rows: WorkspaceAgentRow[]
    tab: TerminalTab
    leafId: string
    title: string
  }
): void {
  const row = buildTitleDerivedAgentRow({
    tab: args.tab,
    leafId: args.leafId,
    title: args.title,
    now: args.now,
    runtimeAgentOrchestrationByPaneKey: args.runtimeAgentOrchestrationByPaneKey
  })
  if (!row || args.seenPaneKeys.has(row.paneKey)) {
    return
  }
  args.rows.push(row)
  args.seenPaneKeys.add(row.paneKey)
}

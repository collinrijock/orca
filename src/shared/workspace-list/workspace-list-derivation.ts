import { parsePaneKey } from '../stable-pane-id'
import type { AgentStatusEntry } from '../agent-status-types'
import type { Repo, TerminalLayoutSnapshot, TerminalTab, Worktree } from '../types'
import { buildWorkspaceAgentRows } from './workspace-agent-rows'
import { addWorkspaceHostSectionRows, orderWorkspaceHostOptions } from './workspace-host-sections'
import type {
  WorkspaceAgentRow,
  WorkspaceListInput,
  WorkspaceListModel,
  WorkspaceRetainedAgentEntry
} from './workspace-list-model'
import { deriveSortedWorktreeIds } from './workspace-ordering'
import { buildWorkspaceSectionRows } from './workspace-section-rows'
import { getWorktreeIdsWithLiveAgent } from './workspace-terminal-liveness'
import { computeVisibleWorktreeIds } from './workspace-visible-workspaces'

function getAllWorktrees(worktreesByRepo: Record<string, Worktree[]>): Worktree[] {
  return Object.values(worktreesByRepo).flat()
}

function groupLiveEntriesByWorktree(args: {
  entries: readonly AgentStatusEntry[]
  tabsByWorktree: Record<string, TerminalTab[]>
}): Map<string, AgentStatusEntry[]> {
  const tabIdToWorktreeId = new Map<string, string>()
  for (const [worktreeId, tabs] of Object.entries(args.tabsByWorktree)) {
    for (const tab of tabs) {
      tabIdToWorktreeId.set(tab.id, worktreeId)
    }
  }
  const entriesByWorktree = new Map<string, AgentStatusEntry[]>()
  for (const entry of args.entries) {
    const parsed = parsePaneKey(entry.paneKey)
    const worktreeId =
      (parsed ? tabIdToWorktreeId.get(parsed.tabId) : undefined) ?? entry.worktreeId
    if (!worktreeId) {
      continue
    }
    const bucket = entriesByWorktree.get(worktreeId)
    if (bucket) {
      bucket.push(entry)
    } else {
      entriesByWorktree.set(worktreeId, [entry])
    }
  }
  return entriesByWorktree
}

function groupRetainedEntriesByWorktree(
  retainedAgentsByPaneKey: Record<string, WorkspaceRetainedAgentEntry> | undefined
): Map<string, WorkspaceRetainedAgentEntry[]> {
  const retainedByWorktree = new Map<string, WorkspaceRetainedAgentEntry[]>()
  for (const retained of Object.values(retainedAgentsByPaneKey ?? {})) {
    const bucket = retainedByWorktree.get(retained.worktreeId)
    if (bucket) {
      bucket.push(retained)
    } else {
      retainedByWorktree.set(retained.worktreeId, [retained])
    }
  }
  return retainedByWorktree
}

function selectRecordForTabs<T>(
  tabs: readonly TerminalTab[],
  source: Record<string, T> | undefined | null
): Record<string, T> {
  const result: Record<string, T> = {}
  if (!source) {
    return result
  }
  for (const tab of tabs) {
    const value = source[tab.id]
    if (value !== undefined) {
      result[tab.id] = value
    }
  }
  return result
}

function buildAgentsByWorktreeId(args: {
  worktrees: readonly Worktree[]
  tabsByWorktree: Record<string, TerminalTab[]>
  agentStatusByPaneKey?: Record<string, AgentStatusEntry>
  retainedAgentsByPaneKey?: Record<string, WorkspaceRetainedAgentEntry>
  runtimePaneTitlesByTabId?: Record<string, Record<number, string>>
  ptyIdsByTabId?: Record<string, string[]> | null
  terminalLayoutsByTabId?: Record<string, TerminalLayoutSnapshot | undefined>
  runtimeAgentOrchestrationByPaneKey?: WorkspaceListInput['runtimeAgentOrchestrationByPaneKey']
  now: number
}): Record<string, WorkspaceAgentRow[]> {
  const entriesByWorktree = groupLiveEntriesByWorktree({
    entries: Object.values(args.agentStatusByPaneKey ?? {}),
    tabsByWorktree: args.tabsByWorktree
  })
  const retainedByWorktree = groupRetainedEntriesByWorktree(args.retainedAgentsByPaneKey)
  const agentsByWorktreeId: Record<string, WorkspaceAgentRow[]> = {}
  const worktreeIds = new Set(args.worktrees.map((worktree) => worktree.id))
  for (const worktreeId of new Set([
    ...worktreeIds,
    ...entriesByWorktree.keys(),
    ...retainedByWorktree.keys()
  ])) {
    const tabs = args.tabsByWorktree[worktreeId] ?? []
    const rows = buildWorkspaceAgentRows({
      tabs,
      entries: entriesByWorktree.get(worktreeId) ?? [],
      retained: retainedByWorktree.get(worktreeId) ?? [],
      runtimePaneTitlesByTabId: selectRecordForTabs(tabs, args.runtimePaneTitlesByTabId),
      ptyIdsByTabId: selectRecordForTabs(tabs, args.ptyIdsByTabId),
      terminalLayoutsByTabId: selectRecordForTabs(tabs, args.terminalLayoutsByTabId),
      runtimeAgentOrchestrationByPaneKey: args.runtimeAgentOrchestrationByPaneKey,
      now: args.now
    })
    if (rows.length > 0) {
      agentsByWorktreeId[worktreeId] = rows
    }
  }
  return agentsByWorktreeId
}

function buildRepoMap(repos: readonly Repo[]): Map<string, Repo> {
  return new Map(repos.map((repo) => [repo.id, repo]))
}

export function deriveWorkspaceListModel(
  input: WorkspaceListInput,
  now: number
): WorkspaceListModel {
  const repoMap = buildRepoMap(input.repos)
  const collapsedGroups = new Set(input.preferences.collapsedGroups)
  const allWorktrees = getAllWorktrees(input.worktreesByRepo)
  const nonArchivedWorktrees = allWorktrees.filter((worktree) => !worktree.isArchived)
  const tabsByWorktree = input.tabsByWorktree ?? {}
  const sortedWorktreeIds = deriveSortedWorktreeIds({
    worktrees: nonArchivedWorktrees,
    sortBy: input.preferences.sortBy,
    repoMap,
    now,
    tabsByWorktree,
    agentStatusByPaneKey: input.agentStatusByPaneKey,
    runtimePaneTitlesByTabId: input.runtimePaneTitlesByTabId,
    ptyIdsByTabId: input.ptyIdsByTabId,
    migrationUnsupportedByPtyId: input.migrationUnsupportedByPtyId,
    terminalLayoutsByTabId: input.terminalLayoutsByTabId
  })
  const visibleWorktreeIds = computeVisibleWorktreeIds(input.worktreesByRepo, sortedWorktreeIds, {
    filterRepoIds: input.preferences.filterRepoIds,
    showSleepingWorkspaces: input.preferences.showSleepingWorkspaces,
    tabsByWorktree,
    ptyIdsByTabId: input.ptyIdsByTabId ?? null,
    browserTabsByWorktree: input.browserTabsByWorktree,
    worktreeIdsWithLiveAgent: getWorktreeIdsWithLiveAgent(
      input.agentStatusByPaneKey,
      tabsByWorktree,
      now
    ),
    hideDefaultBranchWorkspace: input.preferences.hideDefaultBranchWorkspace,
    hideAutomationGeneratedWorkspaces: input.preferences.hideAutomationGeneratedWorkspaces,
    repoMap,
    workspaceHostScope: input.preferences.workspaceHostScope,
    visibleWorkspaceHostIds: input.preferences.visibleWorkspaceHostIds,
    defaultHostId: input.defaultHostId,
    worktreeLineageById: input.worktreeLineageById ?? {}
  })
  const worktreeMap = new Map(allWorktrees.map((worktree) => [worktree.id, worktree]))
  const visibleWorktrees = visibleWorktreeIds
    .map((id) => worktreeMap.get(id))
    .filter((worktree): worktree is Worktree => worktree !== undefined)
  const repoOrder = new Map(input.repos.map((repo, index) => [repo.id, index]))
  const orderedHostOptions = orderWorkspaceHostOptions(
    input.hostOptions ?? [],
    input.preferences.workspaceHostOrder
  )
  const hostLabelById = new Map(orderedHostOptions.map((host) => [host.id, host.label]))
  const sectionRows = buildWorkspaceSectionRows({
    groupBy: input.preferences.groupBy,
    worktrees: visibleWorktrees,
    repoMap,
    reviewStateByWorktreeId: input.reviewStateByWorktreeId,
    collapsedGroups,
    repoOrder,
    workspaceStatuses: input.workspaceStatuses,
    projectOrderBy: input.preferences.projectOrderBy,
    lineageById: input.worktreeLineageById ?? {},
    worktreeMap,
    nestLineage: true,
    projectGroups: input.projectGroups,
    placeholderRepoIds: input.placeholderRepoIds,
    importedWorktreesByRepo: input.importedWorktreesByRepo,
    newExternalWorktreesInboxByRepo: input.newExternalWorktreesInboxByRepo,
    pendingCreations: input.pendingCreations,
    projectGrouping: input.projectGrouping,
    folderWorkspaces: input.folderWorkspaces,
    hostLabelById
  })
  const rows = addWorkspaceHostSectionRows({
    rows: sectionRows,
    hostOptions: orderedHostOptions,
    workspaceHostScope: input.preferences.workspaceHostScope,
    visibleWorkspaceHostIds: input.preferences.visibleWorkspaceHostIds,
    defaultHostId: input.defaultHostId,
    collapsedHostKeys: collapsedGroups,
    preferProjectGrouping: true
  })
  return {
    modelVersion: 1,
    generatedAt: now,
    preferences: input.preferences,
    sortedWorktreeIds,
    visibleWorktreeIds,
    rows,
    totalRowCount: rows.length,
    agentsByWorktreeId: buildAgentsByWorktreeId({
      worktrees: allWorktrees,
      tabsByWorktree,
      agentStatusByPaneKey: input.agentStatusByPaneKey,
      retainedAgentsByPaneKey: input.retainedAgentsByPaneKey,
      runtimePaneTitlesByTabId: input.runtimePaneTitlesByTabId,
      ptyIdsByTabId: input.ptyIdsByTabId,
      terminalLayoutsByTabId: input.terminalLayoutsByTabId,
      runtimeAgentOrchestrationByPaneKey: input.runtimeAgentOrchestrationByPaneKey,
      now
    }),
    sourceCompletenessWarnings: [...(input.sourceCompletenessWarnings ?? [])]
  }
}

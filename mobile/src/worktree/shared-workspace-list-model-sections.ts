import type {
  RuntimeWorktreeAgentRow,
  RuntimeWorkspaceListModelResult
} from '../../../src/shared/runtime-types'
import type { WorkspaceAgentRow } from '../../../src/shared/workspace-list/workspace-list-model'
import type { Section, Worktree } from './workspace-list-types'

type SharedModelSectionArgs = {
  model: RuntimeWorkspaceListModelResult
  displayWorktrees: readonly Worktree[]
  search: string
}

function matchesSearch(worktree: Worktree, query: string): boolean {
  return (
    (worktree.displayName || worktree.repo).toLowerCase().includes(query) ||
    worktree.branch.toLowerCase().includes(query) ||
    worktree.repo.toLowerCase().includes(query)
  )
}

function fallbackWorktreeForItem(
  row: Extract<RuntimeWorkspaceListModelResult['rows'][number], { type: 'item' }>
): Worktree {
  const shared = row.worktree
  return {
    workspaceKind: 'git',
    worktreeId: shared.id,
    repoId: shared.repoId,
    repo: row.repo?.displayName ?? shared.repoId,
    branch: shared.branch,
    displayName: shared.displayName,
    workspaceStatus: shared.workspaceStatus,
    sortOrder: shared.sortOrder,
    manualOrder: shared.manualOrder,
    path: shared.path,
    isArchived: shared.isArchived,
    isMainWorktree: shared.isMainWorktree,
    hasHostSidebarActivity: false,
    parentWorktreeId: null,
    childWorktreeIds: [],
    liveTerminalCount: 0,
    hasAttachedPty: false,
    preview: '',
    unread: shared.isUnread,
    lastOutputAt: shared.lastActivityAt,
    isPinned: shared.isPinned,
    isActive: false,
    linkedPR: shared.linkedPR == null ? null : { number: shared.linkedPR, state: 'open' },
    linkedIssue: shared.linkedIssue,
    linkedLinearIssue: shared.linkedLinearIssue,
    linkedGitLabMR: shared.linkedGitLabMR,
    linkedGitLabIssue: shared.linkedGitLabIssue,
    comment: shared.comment,
    status: 'inactive',
    agents: []
  }
}

function fallbackWorktreeForFolder(
  row: Extract<RuntimeWorkspaceListModelResult['rows'][number], { type: 'folder-workspace' }>
): Worktree {
  const id = `folder:${row.folderWorkspace.id}`
  return {
    workspaceKind: 'folder-workspace',
    worktreeId: id,
    repoId: `folder-workspace:${row.folderWorkspace.projectGroupId}`,
    repo: row.projectGroup.name,
    branch: '',
    displayName: row.folderWorkspace.name,
    workspaceStatus: row.folderWorkspace.workspaceStatus,
    sortOrder: row.folderWorkspace.sortOrder,
    manualOrder: row.folderWorkspace.manualOrder,
    path: row.folderWorkspace.folderPath,
    isArchived: row.folderWorkspace.isArchived,
    isMainWorktree: false,
    hasHostSidebarActivity: false,
    parentWorktreeId: null,
    childWorktreeIds: [],
    liveTerminalCount: 0,
    hasAttachedPty: false,
    preview: '',
    unread: row.folderWorkspace.isUnread,
    lastOutputAt: row.folderWorkspace.lastActivityAt,
    isPinned: row.folderWorkspace.isPinned,
    isActive: false,
    linkedPR: null,
    linkedIssue:
      row.folderWorkspace.linkedTask?.provider === 'github' &&
      row.folderWorkspace.linkedTask.type === 'issue'
        ? row.folderWorkspace.linkedTask.number
        : null,
    linkedLinearIssue:
      row.folderWorkspace.linkedTask?.provider === 'linear'
        ? (row.folderWorkspace.linkedTask.linearIdentifier ?? null)
        : null,
    linkedGitLabMR:
      row.folderWorkspace.linkedTask?.provider === 'gitlab' &&
      row.folderWorkspace.linkedTask.type === 'mr'
        ? row.folderWorkspace.linkedTask.number
        : null,
    linkedGitLabIssue:
      row.folderWorkspace.linkedTask?.provider === 'gitlab' &&
      row.folderWorkspace.linkedTask.type === 'issue'
        ? row.folderWorkspace.linkedTask.number
        : null,
    comment: row.folderWorkspace.comment,
    status: 'inactive',
    agents: []
  }
}

function agentRowsForMobile(
  rows: readonly WorkspaceAgentRow[] | undefined
): RuntimeWorktreeAgentRow[] {
  const mobileRows: RuntimeWorktreeAgentRow[] = []
  let currentRootPaneKey: string | null = null
  for (const row of rows ?? []) {
    const depth = row.lineage?.depth ?? 0
    const parentPaneKey =
      row.entry.orchestration?.parentPaneKey ??
      (depth > 0 && currentRootPaneKey ? currentRootPaneKey : null)
    if (depth === 0) {
      currentRootPaneKey = row.paneKey
    }
    mobileRows.push({
      paneKey: row.paneKey,
      parentPaneKey,
      state: row.state,
      agentType: row.agentType ?? null,
      prompt: row.entry.prompt,
      taskTitle: row.entry.orchestration?.taskTitle ?? null,
      displayName: row.entry.orchestration?.displayName ?? null,
      lastAssistantMessage: row.entry.lastAssistantMessage ?? null,
      toolName: row.entry.toolName ?? null,
      toolInput: row.entry.toolInput ?? null,
      interrupted: row.entry.interrupted ?? false,
      stateStartedAt: row.entry.stateStartedAt,
      updatedAt: row.entry.updatedAt
    })
  }
  return mobileRows
}

function sectionForHeader(
  row: Extract<RuntimeWorkspaceListModelResult['rows'][number], { type: 'header' }>
): Section {
  return {
    key: row.key,
    title: row.label,
    icon: row.visual === 'pinned' ? 'pin' : undefined,
    count: row.count,
    data: []
  }
}

function applySharedRowMetadata(args: {
  base: Worktree
  rowKey: string
  depth: number
  lineageChildCount: number
  lineageCollapsed?: boolean
  isLastLineageChild?: boolean
  agents?: RuntimeWorktreeAgentRow[]
}): Worktree {
  return {
    ...args.base,
    sectionListKey: args.rowKey,
    lineageDepth: args.depth,
    lineageChildCount: args.lineageChildCount,
    lineageCollapsed: args.lineageCollapsed,
    isLastLineageChild: args.isLastLineageChild,
    agents: args.agents ?? args.base.agents
  }
}

export function buildMobileSectionsFromWorkspaceListModel({
  model,
  displayWorktrees,
  search
}: SharedModelSectionArgs): Section[] {
  const worktreesById = new Map(displayWorktrees.map((worktree) => [worktree.worktreeId, worktree]))
  const query = search.trim().toLowerCase()
  const sections: Section[] = []
  let currentSection: Section | null = null

  const ensureSection = (sectionKey: string): Section => {
    if (currentSection?.key === sectionKey) {
      return currentSection
    }
    currentSection = { key: sectionKey, title: '', data: [] }
    sections.push(currentSection)
    return currentSection
  }

  for (const row of model.rows) {
    if (row.type === 'host-header') {
      continue
    }
    if (row.type === 'header') {
      currentSection = sectionForHeader(row)
      sections.push(currentSection)
      continue
    }
    if (row.type === 'item') {
      const base = worktreesById.get(row.worktree.id) ?? fallbackWorktreeForItem(row)
      if (query && !matchesSearch(base, query)) {
        continue
      }
      ensureSection(row.sectionKey).data.push(
        applySharedRowMetadata({
          base,
          rowKey: row.rowKey,
          depth: row.depth,
          lineageChildCount: row.lineageChildCount,
          lineageCollapsed: row.lineageCollapsed,
          isLastLineageChild: row.isLastLineageChild,
          agents: agentRowsForMobile(model.agentsByWorktreeId[row.worktree.id])
        })
      )
      continue
    }
    if (row.type === 'folder-workspace') {
      const id = `folder:${row.folderWorkspace.id}`
      const base = worktreesById.get(id) ?? fallbackWorktreeForFolder(row)
      if (query && !matchesSearch(base, query)) {
        continue
      }
      const targetSection = currentSection ?? ensureSection(row.projectGroup.id)
      targetSection.data.push(
        applySharedRowMetadata({
          base,
          rowKey: row.key,
          depth: row.depth,
          lineageChildCount: 0,
          agents: agentRowsForMobile(model.agentsByWorktreeId[id])
        })
      )
    }
  }

  return sections
    .map((section) => ({
      ...section,
      count: query ? section.data.length : (section.count ?? section.data.length)
    }))
    .filter((section) =>
      // Why: under an active search, drop group headers whose items all filtered
      // out so we don't render empty "Done 0" rows — matching the local
      // buildSections path, which never emits an item-less group.
      query ? section.data.length > 0 : section.title || section.data.length > 0
    )
}

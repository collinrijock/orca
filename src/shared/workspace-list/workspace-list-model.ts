import type {
  AgentStatusEntry,
  AgentStatusOrchestrationContext,
  AgentStatusState,
  AgentType,
  MigrationUnsupportedPtyEntry
} from '../agent-status-types'
import type { ExecutionHostId, ExecutionHostKind, ExecutionHostScope } from '../execution-host'
import type { ExecutionHostHealth } from '../execution-host-registry'
import type { RuntimeCompatVerdict } from '../protocol-compat'
import type { SshConnectionStatus } from '../ssh-types'
import type {
  DetectedWorktree,
  FolderWorkspace,
  Project,
  ProjectGroup,
  ProjectHostSetup,
  ProjectOrderBy,
  Repo,
  TerminalLayoutSnapshot,
  TerminalTab,
  Worktree,
  WorktreeLineage,
  WorkspaceStatusDefinition
} from '../types'

export type WorkspaceListGroupBy = 'none' | 'workspace-status' | 'repo' | 'pr-status'
export type WorkspaceListSortBy = 'name' | 'smart' | 'recent' | 'repo' | 'manual'

export type WorkspaceListPreferences = {
  groupBy: WorkspaceListGroupBy
  sortBy: WorkspaceListSortBy
  projectOrderBy: ProjectOrderBy
  collapsedGroups: readonly string[]
  filterRepoIds: readonly string[]
  showSleepingWorkspaces: boolean
  hideDefaultBranchWorkspace: boolean
  hideAutomationGeneratedWorkspaces: boolean
  workspaceHostScope: ExecutionHostScope
  visibleWorkspaceHostIds?: readonly ExecutionHostId[] | null
  workspaceHostOrder?: readonly ExecutionHostId[]
}

export type WorkspaceReviewGroupKey = 'done' | 'in-review' | 'in-progress' | 'closed'

export type WorkspaceReviewState = {
  provider: 'github' | 'gitlab' | 'bitbucket' | 'azure-devops' | 'gitea' | 'other'
  reviewType: 'pr' | 'mr' | 'review'
  number?: number | null
  state?: string | null
  group: WorkspaceReviewGroupKey
}

export type WorkspaceRetainedAgentEntry = {
  entry: AgentStatusEntry
  worktreeId: string
  tab: TerminalTab
  agentType: AgentType
  startedAt: number
}

export type WorkspaceAgentRowLineage = {
  depth: 0 | 1
  isFirstSibling: boolean
  isLastSibling: boolean
  childCount: number
}

export type WorkspaceAgentRow = {
  paneKey: string
  entry: AgentStatusEntry
  tab: TerminalTab
  agentType: AgentType
  rowSource: 'live' | 'retained'
  state: AgentStatusState | 'idle'
  startedAt: number
  lineage?: WorkspaceAgentRowLineage
}

export type WorkspaceProjectGroupingModel = {
  projects: readonly Project[]
  projectHostSetups: readonly ProjectHostSetup[]
}

export type WorkspaceImportedWorktreesCandidate = {
  repo: Repo
  hiddenWorktrees: DetectedWorktree[]
}

export type WorkspaceExternalWorktreesInboxCandidate = {
  repo: Repo
  inboxWorktrees: DetectedWorktree[]
}

export type WorkspacePendingCreationRef = { creationId: string; repoId: string }

export type WorkspaceGroupHeaderVisual =
  | 'all'
  | 'pinned'
  | 'project'
  | 'project-group'
  | 'workspace-status'
  | 'review'

export type WorkspaceGroupHeaderRow = {
  type: 'header'
  key: string
  label: string
  count: number
  visual: WorkspaceGroupHeaderVisual
  repo?: Repo
  projectGroup?: ProjectGroup | { id: null; name: 'Ungrouped'; tabOrder: number }
  projectGroupDepth?: number
  workspaceStatus?: string
  reviewGroup?: WorkspaceReviewGroupKey
}

export type WorkspaceItemRow = {
  type: 'item'
  rowKey: string
  sectionKey: string
  worktree: Worktree
  repo: Repo | undefined
  depth: number
  groupDepth: number
  lineageTrail: boolean[]
  isLastLineageChild: boolean
  lineageChildCount: number
  lineageGroupKey?: string
  lineageCollapsed?: boolean
  hostContextLabel?: string
}

export type WorkspaceImportedWorktreesCardRow = {
  type: 'imported-worktrees-card'
  key: string
  repo: Repo
  hiddenWorktrees: DetectedWorktree[]
  placement: 'repo-group' | 'pinned-fallback'
}

export type WorkspaceExternalWorktreesInboxRow = {
  type: 'new-external-worktrees-inbox'
  key: string
  repo: Repo
  inboxWorktrees: DetectedWorktree[]
}

export type WorkspacePendingCreationRow = {
  type: 'pending-creation'
  key: string
  creationId: string
  repo: Repo | undefined
}

export type WorkspaceFolderWorkspaceRow = {
  type: 'folder-workspace'
  key: string
  folderWorkspace: FolderWorkspace
  projectGroup: ProjectGroup
  depth: number
  groupDepth: number
}

export type WorkspaceSectionRow =
  | WorkspaceGroupHeaderRow
  | WorkspaceItemRow
  | WorkspaceImportedWorktreesCardRow
  | WorkspaceExternalWorktreesInboxRow
  | WorkspacePendingCreationRow
  | WorkspaceFolderWorkspaceRow

export type WorkspaceHostHeaderRow = {
  type: 'host-header'
  key: string
  hostId: ExecutionHostId
  kind: ExecutionHostKind
  label: string
  detail: string
  health: ExecutionHostHealth
  compatibility?: RuntimeCompatVerdict
  connectionStatus?: SshConnectionStatus
  collapsed: boolean
  count: number
}

export type WorkspaceListRow = WorkspaceSectionRow | WorkspaceHostHeaderRow

export type WorkspaceHostOption = {
  id: ExecutionHostId
  kind: ExecutionHostKind
  label: string
  detail: string
  health: ExecutionHostHealth
  compatibility?: RuntimeCompatVerdict
  connectionStatus?: SshConnectionStatus
}

export type WorkspaceListInput = {
  preferences: WorkspaceListPreferences
  repos: readonly Repo[]
  worktreesByRepo: Record<string, Worktree[]>
  workspaceStatuses: readonly WorkspaceStatusDefinition[]
  tabsByWorktree?: Record<string, TerminalTab[]> | null
  ptyIdsByTabId?: Record<string, string[]> | null
  browserTabsByWorktree?: Record<string, { id: string }[]> | null
  worktreeLineageById?: Record<string, WorktreeLineage>
  reviewStateByWorktreeId?: Record<string, WorkspaceReviewState | undefined>
  agentStatusByPaneKey?: Record<string, AgentStatusEntry>
  migrationUnsupportedByPtyId?: Record<string, MigrationUnsupportedPtyEntry>
  retainedAgentsByPaneKey?: Record<string, WorkspaceRetainedAgentEntry>
  runtimePaneTitlesByTabId?: Record<string, Record<number, string>>
  terminalLayoutsByTabId?: Record<string, TerminalLayoutSnapshot | undefined>
  runtimeAgentOrchestrationByPaneKey?: Record<string, AgentStatusOrchestrationContext>
  projectGroups?: readonly ProjectGroup[]
  projectGrouping?: WorkspaceProjectGroupingModel
  folderWorkspaces?: readonly FolderWorkspace[]
  placeholderRepoIds?: ReadonlySet<string>
  importedWorktreesByRepo?: ReadonlyMap<string, WorkspaceImportedWorktreesCandidate>
  newExternalWorktreesInboxByRepo?: ReadonlyMap<string, WorkspaceExternalWorktreesInboxCandidate>
  pendingCreations?: readonly WorkspacePendingCreationRef[]
  hostOptions?: readonly WorkspaceHostOption[]
  defaultHostId: ExecutionHostId
  sourceCompletenessWarnings?: readonly string[]
}

export type WorkspaceListModel = {
  modelVersion: 1
  generatedAt: number
  preferences: WorkspaceListPreferences
  sortedWorktreeIds: string[]
  visibleWorktreeIds: string[]
  rows: WorkspaceListRow[]
  totalRowCount: number
  agentsByWorktreeId: Record<string, WorkspaceAgentRow[]>
  sourceCompletenessWarnings: string[]
}

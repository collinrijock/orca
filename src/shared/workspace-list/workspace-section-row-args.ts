import { cloneDefaultWorkspaceStatuses } from '../workspace-statuses'
import type {
  FolderWorkspace,
  ProjectGroup,
  ProjectOrderBy,
  Repo,
  Worktree,
  WorktreeLineage,
  WorkspaceStatusDefinition
} from '../types'
import type {
  WorkspaceExternalWorktreesInboxCandidate,
  WorkspaceImportedWorktreesCandidate,
  WorkspacePendingCreationRef,
  WorkspaceProjectGroupingModel,
  WorkspaceReviewState
} from './workspace-list-model'
import type { WorktreeGroupBy } from './workspace-section-constants'

export type BuildRowsArgs = {
  groupBy: WorktreeGroupBy
  worktrees: Worktree[]
  repoMap: Map<string, Repo>
  reviewStateByWorktreeId?: Record<string, WorkspaceReviewState | undefined>
  collapsedGroups: Set<string>
  repoOrder?: Map<string, number>
  workspaceStatuses?: readonly WorkspaceStatusDefinition[]
  projectOrderBy?: ProjectOrderBy
  lineageById?: Record<string, WorktreeLineage>
  worktreeMap?: Map<string, Worktree>
  nestLineage?: boolean
  projectGroups?: readonly ProjectGroup[]
  placeholderRepoIds?: ReadonlySet<string>
  importedWorktreesByRepo?: ReadonlyMap<string, WorkspaceImportedWorktreesCandidate>
  newExternalWorktreesInboxByRepo?: ReadonlyMap<string, WorkspaceExternalWorktreesInboxCandidate>
  pendingCreations?: readonly WorkspacePendingCreationRef[]
  projectGrouping?: WorkspaceProjectGroupingModel
  folderWorkspaces?: readonly FolderWorkspace[]
  hostLabelById?: ReadonlyMap<string, string>
}

export type NormalizedRowsArgs = Required<
  Pick<
    BuildRowsArgs,
    | 'workspaceStatuses'
    | 'lineageById'
    | 'worktreeMap'
    | 'nestLineage'
    | 'projectGroups'
    | 'placeholderRepoIds'
    | 'importedWorktreesByRepo'
    | 'newExternalWorktreesInboxByRepo'
    | 'pendingCreations'
    | 'folderWorkspaces'
  >
> &
  Omit<
    BuildRowsArgs,
    | 'workspaceStatuses'
    | 'lineageById'
    | 'worktreeMap'
    | 'nestLineage'
    | 'projectGroups'
    | 'placeholderRepoIds'
    | 'importedWorktreesByRepo'
    | 'newExternalWorktreesInboxByRepo'
    | 'pendingCreations'
    | 'folderWorkspaces'
  >

export function normalizeArgs(args: BuildRowsArgs): NormalizedRowsArgs {
  return {
    ...args,
    workspaceStatuses: args.workspaceStatuses ?? cloneDefaultWorkspaceStatuses(),
    lineageById: args.lineageById ?? {},
    worktreeMap:
      args.worktreeMap ?? new Map(args.worktrees.map((worktree) => [worktree.id, worktree])),
    nestLineage: args.nestLineage ?? false,
    projectGroups: args.projectGroups ?? [],
    placeholderRepoIds: args.placeholderRepoIds ?? new Set(),
    importedWorktreesByRepo: args.importedWorktreesByRepo ?? new Map(),
    newExternalWorktreesInboxByRepo: args.newExternalWorktreesInboxByRepo ?? new Map(),
    pendingCreations: args.pendingCreations ?? [],
    folderWorkspaces: args.folderWorkspaces ?? []
  }
}

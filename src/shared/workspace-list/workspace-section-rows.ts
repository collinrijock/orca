import {
  cloneDefaultWorkspaceStatuses,
  getWorkspaceStatus,
  getWorkspaceStatusGroupKey
} from '../workspace-statuses'
import type { ProjectGroup, Repo, Worktree, WorkspaceStatusDefinition } from '../types'
import type { OrderedGroupEntry } from './project-section-order'
import { getWorkspaceReviewGroupKey } from './workspace-review-state'
import type { WorkspaceReviewState, WorkspaceSectionRow } from './workspace-list-model'
import { appendWorktreeRows } from './workspace-lineage-section-rows'
import { buildProjectGroupingIndex, getProjectGroupingForRepo } from './workspace-project-grouping'
import { appendProjectGroupRows } from './workspace-project-group-section-rows'
import { buildPendingByRepo, buildGroups, orderGroups } from './workspace-section-grouping'
import { appendGroups } from './workspace-section-group-appending'
import {
  buildPendingCreationRow,
  emitPinnedGroup,
  withRepoSectionDisplayLabels
} from './workspace-section-row-primitives'
import {
  ALL_GROUP_KEY,
  getProjectGroupHeaderKey,
  type WorktreeGroupBy
} from './workspace-section-constants'
import {
  normalizeArgs,
  type BuildRowsArgs,
  type NormalizedRowsArgs
} from './workspace-section-row-args'

export type { WorktreeGroupBy } from './workspace-section-constants'
export {
  ALL_GROUP_KEY,
  getLineageGroupKey,
  getProjectGroupHeaderKey,
  LINEAGE_GROUP_PREFIX,
  PINNED_GROUP_KEY
} from './workspace-section-constants'
export type { LineageRenderInfo } from './workspace-lineage-section-rows'
export { getLineageRenderInfo } from './workspace-lineage-section-rows'
export type { ProjectHeaderRevealTarget } from './workspace-project-grouping'
export { getProjectHeaderRevealTarget } from './workspace-project-grouping'

export function buildWorkspaceSectionRows(rawArgs: BuildRowsArgs): WorkspaceSectionRow[] {
  const args = normalizeArgs(rawArgs)
  const result: WorkspaceSectionRow[] = []
  const pendingByRepo = buildPendingByRepo(args.pendingCreations)

  if (args.groupBy !== 'repo') {
    for (const creation of args.pendingCreations) {
      result.push(buildPendingCreationRow(creation, args.repoMap))
    }
  }

  emitPinnedGroup({
    worktrees: args.worktrees,
    repoMap: args.repoMap,
    collapsedGroups: args.collapsedGroups,
    visibleUnpinnedRepoIds: new Set(
      args.worktrees.filter((worktree) => !worktree.isPinned).map((worktree) => worktree.repoId)
    ),
    importedWorktreesByRepo: args.importedWorktreesByRepo,
    allowImportedFallback: args.groupBy !== 'repo',
    result
  })

  if (args.groupBy === 'none') {
    appendAllGroupRows(result, args)
    return result
  }

  const orderedGroups = orderGroups(buildGroups(args), args)
  const appendOrderedGroups = (
    groupsToAppend: OrderedGroupEntry[],
    projectGroupDepth = 0
  ): void => {
    appendGroups({ source: args, result, groupsToAppend, projectGroupDepth, pendingByRepo })
  }

  if (args.groupBy !== 'repo' || args.projectGroups.length === 0) {
    appendOrderedGroups(
      args.groupBy === 'repo' ? withRepoSectionDisplayLabels(orderedGroups) : orderedGroups
    )
    return result
  }

  appendProjectGroupRows({
    result,
    orderedGroups,
    projectGroups: args.projectGroups,
    folderWorkspaces: args.folderWorkspaces,
    collapsedGroups: args.collapsedGroups,
    projectOrderBy: args.projectOrderBy ?? 'manual',
    repoOrder: args.repoOrder,
    appendOrderedGroups
  })
  return result
}

function appendAllGroupRows(result: WorkspaceSectionRow[], args: NormalizedRowsArgs): void {
  if (args.worktrees.length === 0) {
    return
  }
  result.push({
    type: 'header',
    key: ALL_GROUP_KEY,
    label: 'All',
    count: args.worktrees.length,
    visual: 'all'
  })
  if (!args.collapsedGroups.has(ALL_GROUP_KEY)) {
    appendWorktreeRows(result, args.worktrees, args.repoMap, args.lineageById, args.worktreeMap, {
      nestLineage: args.nestLineage,
      collapsedGroups: args.collapsedGroups,
      groupDepth: 0,
      sectionKey: ALL_GROUP_KEY
    })
  }
}

export function getGroupKeyForWorktree(args: {
  groupBy: WorktreeGroupBy
  worktree: Worktree
  repoMap: Map<string, Repo>
  reviewStateByWorktreeId?: Record<string, WorkspaceReviewState | undefined>
  workspaceStatuses?: readonly WorkspaceStatusDefinition[]
  projectGrouping?: BuildRowsArgs['projectGrouping']
}): string | null {
  const workspaceStatuses = args.workspaceStatuses ?? cloneDefaultWorkspaceStatuses()
  if (args.groupBy === 'none') {
    return ALL_GROUP_KEY
  }
  if (args.groupBy === 'workspace-status') {
    return getWorkspaceStatusGroupKey(getWorkspaceStatus(args.worktree, workspaceStatuses))
  }
  if (args.groupBy === 'repo') {
    return getProjectGroupingForRepo(
      args.worktree.repoId,
      args.repoMap,
      buildProjectGroupingIndex(args.projectGrouping)
    ).key
  }
  return `pr:${getWorkspaceReviewGroupKey(args.worktree, args.reviewStateByWorktreeId)}`
}

export function getGroupKeysForWorktree(args: {
  groupBy: WorktreeGroupBy
  worktree: Worktree
  repoMap: Map<string, Repo>
  reviewStateByWorktreeId?: Record<string, WorkspaceReviewState | undefined>
  workspaceStatuses?: readonly WorkspaceStatusDefinition[]
  projectGroups?: readonly ProjectGroup[]
  projectGrouping?: BuildRowsArgs['projectGrouping']
}): string[] {
  const groupKey = getGroupKeyForWorktree(args)
  if (!groupKey) {
    return []
  }
  if (args.groupBy !== 'repo') {
    return [groupKey]
  }
  const repo = args.repoMap.get(args.worktree.repoId)
  const groupIds: string[] = []
  const groupsById = new Map((args.projectGroups ?? []).map((group) => [group.id, group]))
  const visited = new Set<string>()
  let currentGroupId = repo?.projectGroupId ?? null
  while (currentGroupId && !visited.has(currentGroupId)) {
    const group = groupsById.get(currentGroupId)
    if (!group) {
      break
    }
    visited.add(currentGroupId)
    groupIds.unshift(currentGroupId)
    const parentId = group.parentGroupId ?? null
    currentGroupId = parentId && groupsById.has(parentId) ? parentId : null
  }
  return [...groupIds.map((id) => getProjectGroupHeaderKey(id)), groupKey]
}

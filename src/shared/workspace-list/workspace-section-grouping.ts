import { getWorkspaceStatus, getWorkspaceStatusGroupKey } from '../workspace-statuses'
import type { Repo, Worktree } from '../types'
import {
  getManualOrderAnchorRepo,
  sortProjectEntries,
  type OrderedGroupEntry,
  type WorkspaceGroupEntry
} from './project-section-order'
import {
  REVIEW_GROUP_LABELS,
  REVIEW_GROUP_ORDER,
  getWorkspaceReviewGroupKey
} from './workspace-review-state'
import type { WorkspacePendingCreationRef } from './workspace-list-model'
import { buildProjectGroupingIndex, getProjectGroupingForRepo } from './workspace-project-grouping'
import type { NormalizedRowsArgs } from './workspace-section-row-args'

export function addRepoIdToGroup(group: WorkspaceGroupEntry, repoId: string): void {
  group.repoIds.add(repoId)
}

export function buildPendingByRepo(
  pendingCreations: readonly WorkspacePendingCreationRef[]
): Map<string, WorkspacePendingCreationRef[]> {
  const pendingByRepo = new Map<string, WorkspacePendingCreationRef[]>()
  for (const creation of pendingCreations) {
    const list = pendingByRepo.get(creation.repoId) ?? []
    list.push(creation)
    pendingByRepo.set(creation.repoId, list)
  }
  return pendingByRepo
}

function putEmptyRepoGroup(args: {
  grouped: Map<string, WorkspaceGroupEntry>
  repoId: string
  repoMap: Map<string, Repo>
  projectIndex: ReturnType<typeof buildProjectGroupingIndex>
  fallbackRepo?: Repo
}): void {
  const grouping = getProjectGroupingForRepo(args.repoId, args.repoMap, args.projectIndex)
  const key = grouping.key
  if (!args.grouped.has(key)) {
    args.grouped.set(key, {
      label: grouping.label,
      items: [],
      repo: grouping.repo ?? args.fallbackRepo,
      repoIds: new Set([args.repoId])
    })
  } else {
    addRepoIdToGroup(args.grouped.get(key)!, args.repoId)
  }
}

export function buildGroups(args: NormalizedRowsArgs): Map<string, WorkspaceGroupEntry> {
  const grouped = new Map<string, WorkspaceGroupEntry>()
  const projectIndex = buildProjectGroupingIndex(args.projectGrouping)
  for (const worktree of args.worktrees) {
    const { key, label, repo } = getGroupForWorktree(args, worktree, projectIndex)
    if (!grouped.has(key)) {
      grouped.set(key, { label, items: [], repo, repoIds: new Set() })
    }
    const group = grouped.get(key)!
    group.items.push(worktree)
    addRepoIdToGroup(group, worktree.repoId)
  }
  if (args.groupBy !== 'repo') {
    return grouped
  }

  const visiblePinnedRepoIds = new Set(
    args.worktrees.filter((worktree) => worktree.isPinned).map((worktree) => worktree.repoId)
  )
  for (const repoId of args.placeholderRepoIds) {
    putEmptyRepoGroup({ grouped, repoId, repoMap: args.repoMap, projectIndex })
  }
  for (const [repoId, candidate] of args.importedWorktreesByRepo) {
    const key = getProjectGroupingForRepo(repoId, args.repoMap, projectIndex).key
    if (!grouped.has(key) && visiblePinnedRepoIds.has(repoId)) {
      continue
    }
    putEmptyRepoGroup({
      grouped,
      repoId,
      repoMap: args.repoMap,
      projectIndex,
      fallbackRepo: candidate.repo
    })
  }
  for (const [repoId, candidate] of args.newExternalWorktreesInboxByRepo) {
    const key = getProjectGroupingForRepo(repoId, args.repoMap, projectIndex).key
    if (!grouped.has(key) && visiblePinnedRepoIds.has(repoId)) {
      continue
    }
    putEmptyRepoGroup({
      grouped,
      repoId,
      repoMap: args.repoMap,
      projectIndex,
      fallbackRepo: candidate.repo
    })
  }
  for (const repoId of buildPendingByRepo(args.pendingCreations).keys()) {
    putEmptyRepoGroup({ grouped, repoId, repoMap: args.repoMap, projectIndex })
  }
  return grouped
}

function getGroupForWorktree(
  args: NormalizedRowsArgs,
  worktree: Worktree,
  projectIndex: ReturnType<typeof buildProjectGroupingIndex>
): { key: string; label: string; repo?: Repo } {
  if (args.groupBy === 'repo') {
    return getProjectGroupingForRepo(worktree.repoId, args.repoMap, projectIndex)
  }
  if (args.groupBy === 'workspace-status') {
    const workspaceStatus = getWorkspaceStatus(worktree, args.workspaceStatuses)
    return {
      key: getWorkspaceStatusGroupKey(workspaceStatus),
      label:
        args.workspaceStatuses.find((status) => status.id === workspaceStatus)?.label ??
        workspaceStatus
    }
  }
  const reviewGroup = getWorkspaceReviewGroupKey(worktree, args.reviewStateByWorktreeId)
  return { key: `pr:${reviewGroup}`, label: REVIEW_GROUP_LABELS[reviewGroup] }
}

export function orderGroups(
  grouped: Map<string, WorkspaceGroupEntry>,
  args: NormalizedRowsArgs
): OrderedGroupEntry[] {
  if (args.groupBy === 'pr-status') {
    return REVIEW_GROUP_ORDER.flatMap((reviewGroup) => {
      const key = `pr:${reviewGroup}`
      const group = grouped.get(key)
      return group ? ([[key, group]] as OrderedGroupEntry[]) : []
    })
  }
  if (args.groupBy === 'workspace-status') {
    return args.workspaceStatuses.flatMap((status) => {
      const key = getWorkspaceStatusGroupKey(status.id)
      const group = grouped.get(key)
      return group ? ([[key, group]] as OrderedGroupEntry[]) : []
    })
  }
  for (const group of grouped.values()) {
    group.repo = getManualOrderAnchorRepo(group, args.repoMap, args.repoOrder)
  }
  return sortProjectEntries(
    Array.from(grouped.entries()),
    args.projectOrderBy ?? 'manual',
    args.repoOrder
  )
}

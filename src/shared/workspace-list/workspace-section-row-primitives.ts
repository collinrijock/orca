import { getWorkspaceStatusFromGroupKey } from '../workspace-statuses'
import type { Repo, Worktree, WorkspaceStatusDefinition } from '../types'
import type { OrderedGroupEntry, WorkspaceGroupEntry } from './project-section-order'
import { REVIEW_GROUP_LABELS } from './workspace-review-state'
import type {
  WorkspaceExternalWorktreesInboxCandidate,
  WorkspaceExternalWorktreesInboxRow,
  WorkspaceGroupHeaderRow,
  WorkspaceImportedWorktreesCandidate,
  WorkspaceImportedWorktreesCardRow,
  WorkspacePendingCreationRef,
  WorkspacePendingCreationRow,
  WorkspaceSectionRow
} from './workspace-list-model'
import { getRepoDisplayLabelsByPath } from './workspace-repo-display-labels'
import { buildWorktreeRow } from './workspace-lineage-section-rows'
import { PINNED_GROUP_KEY, type WorktreeGroupBy } from './workspace-section-constants'

export function buildPendingCreationRow(
  creation: WorkspacePendingCreationRef,
  repoMap: Map<string, Repo>
): WorkspacePendingCreationRow {
  return {
    type: 'pending-creation',
    key: `pending:${creation.creationId}`,
    creationId: creation.creationId,
    repo: repoMap.get(creation.repoId)
  }
}

export function buildImportedWorktreesCardRow(
  candidate: WorkspaceImportedWorktreesCandidate,
  placement: WorkspaceImportedWorktreesCardRow['placement']
): WorkspaceImportedWorktreesCardRow {
  return {
    type: 'imported-worktrees-card',
    key: `imported-worktrees-card:${placement}:${candidate.repo.id}`,
    repo: candidate.repo,
    hiddenWorktrees: candidate.hiddenWorktrees,
    placement
  }
}

export function buildNewExternalWorktreesInboxRow(
  candidate: WorkspaceExternalWorktreesInboxCandidate
): WorkspaceExternalWorktreesInboxRow {
  return {
    type: 'new-external-worktrees-inbox',
    key: `new-external-worktrees-inbox:${candidate.repo.id}`,
    repo: candidate.repo,
    inboxWorktrees: candidate.inboxWorktrees
  }
}

export function orderMainWorktreeFirst(worktrees: Worktree[]): Worktree[] {
  const mainWorktrees = worktrees.filter((worktree) => worktree.isMainWorktree)
  if (mainWorktrees.length === 0) {
    return worktrees
  }
  return [...mainWorktrees, ...worktrees.filter((worktree) => !worktree.isMainWorktree)]
}

export function withRepoSectionDisplayLabels(
  entries: readonly OrderedGroupEntry[]
): OrderedGroupEntry[] {
  const repos = entries
    .map((entry) => entry[1].repo)
    .filter((repo): repo is Repo => repo !== undefined)
  if (repos.length < 2) {
    return [...entries]
  }
  const labelsByPath = getRepoDisplayLabelsByPath(repos)
  return entries.map(([key, group]) => [
    key,
    group.repo ? { ...group, label: labelsByPath.get(group.repo.path) ?? group.label } : group
  ])
}

export function emitPinnedGroup(args: {
  worktrees: Worktree[]
  repoMap: Map<string, Repo>
  collapsedGroups: Set<string>
  visibleUnpinnedRepoIds: ReadonlySet<string>
  importedWorktreesByRepo: ReadonlyMap<string, WorkspaceImportedWorktreesCandidate>
  allowImportedFallback: boolean
  result: WorkspaceSectionRow[]
}): void {
  const pinned = args.worktrees.filter((worktree) => worktree.isPinned)
  if (pinned.length === 0) {
    return
  }

  args.result.push({
    type: 'header',
    key: PINNED_GROUP_KEY,
    label: 'Pinned',
    count: pinned.length,
    visual: 'pinned'
  })
  if (args.collapsedGroups.has(PINNED_GROUP_KEY)) {
    return
  }
  const lastPinnedIndexByRepoId = new Map<string, number>()
  pinned.forEach((worktree, index) => lastPinnedIndexByRepoId.set(worktree.repoId, index))
  for (const [index, worktree] of pinned.entries()) {
    args.result.push(
      buildWorktreeRow(worktree, args.repoMap, {
        rowKey: `${PINNED_GROUP_KEY}:${worktree.id}`,
        sectionKey: PINNED_GROUP_KEY,
        depth: 0,
        groupDepth: 0,
        lineageTrail: [],
        isLastLineageChild: false,
        lineageChildCount: 0,
        lineageCollapsed: false
      })
    )
    const candidate = args.importedWorktreesByRepo.get(worktree.repoId)
    if (
      args.allowImportedFallback &&
      candidate &&
      !args.visibleUnpinnedRepoIds.has(worktree.repoId) &&
      lastPinnedIndexByRepoId.get(worktree.repoId) === index
    ) {
      args.result.push(buildImportedWorktreesCardRow(candidate, 'pinned-fallback'))
    }
  }
}

export function headerForGroup(args: {
  groupBy: WorktreeGroupBy
  key: string
  group: WorkspaceGroupEntry
  repo?: Repo
  projectGroupDepth: number
  workspaceStatuses: readonly WorkspaceStatusDefinition[]
}): WorkspaceGroupHeaderRow {
  if (args.groupBy === 'repo') {
    return {
      type: 'header',
      key: args.key,
      label: args.group.label,
      count: args.group.items.length,
      visual: 'project',
      repo: args.repo,
      projectGroupDepth: args.projectGroupDepth
    }
  }
  if (args.groupBy === 'workspace-status') {
    const workspaceStatus =
      getWorkspaceStatusFromGroupKey(args.key, args.workspaceStatuses) ??
      args.workspaceStatuses[0]?.id ??
      'in-progress'
    const definition = args.workspaceStatuses.find((status) => status.id === workspaceStatus)
    return {
      type: 'header',
      key: args.key,
      label: definition?.label ?? workspaceStatus,
      count: args.group.items.length,
      visual: 'workspace-status',
      workspaceStatus
    }
  }
  const reviewGroup = args.key.replace(/^pr:/, '') as keyof typeof REVIEW_GROUP_LABELS
  return {
    type: 'header',
    key: args.key,
    label: REVIEW_GROUP_LABELS[reviewGroup],
    count: args.group.items.length,
    visual: 'review',
    reviewGroup
  }
}

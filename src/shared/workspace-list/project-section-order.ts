import { getEffectiveProjectGroupManualRank } from '../project-groups'
import type { ProjectOrderBy, Repo, Worktree } from '../types'

export type WorkspaceGroupEntry = {
  label: string
  items: Worktree[]
  repo?: Repo
  repoIds: Set<string>
}

export type OrderedGroupEntry = [string, WorkspaceGroupEntry]

type RecentRank = { hasActivity: boolean; ts: number }

function recentRankForEntry(entry: OrderedGroupEntry): RecentRank {
  let max = Number.NEGATIVE_INFINITY
  for (const worktree of entry[1].items) {
    if (worktree.lastActivityAt > max) {
      max = worktree.lastActivityAt
    }
  }
  if (max !== Number.NEGATIVE_INFINITY) {
    return { hasActivity: true, ts: max }
  }
  const addedAt = entry[1].repo?.addedAt
  return {
    hasActivity: false,
    ts: typeof addedAt === 'number' ? addedAt : Number.NEGATIVE_INFINITY
  }
}

export function compareRecentProjectRank(a: OrderedGroupEntry, b: OrderedGroupEntry): number {
  const left = recentRankForEntry(a)
  const right = recentRankForEntry(b)
  if (left.hasActivity !== right.hasActivity) {
    return left.hasActivity ? -1 : 1
  }
  return right.ts - left.ts
}

export function manualRankForEntry(
  entry: OrderedGroupEntry,
  repoOrder: Map<string, number> | undefined
): number {
  const key = entry[0]
  const repoIds =
    entry[1].repoIds.size > 0
      ? [...entry[1].repoIds]
      : [key.startsWith('repo:') ? key.slice('repo:'.length) : key]
  let rank = Number.POSITIVE_INFINITY
  for (const repoId of repoIds) {
    const repoRank = repoOrder?.get(repoId)
    if (repoRank !== undefined && repoRank < rank) {
      rank = repoRank
    }
  }
  return rank
}

export function getManualOrderAnchorRepo(
  group: WorkspaceGroupEntry,
  repoMap: Map<string, Repo>,
  repoOrder: Map<string, number> | undefined
): Repo | undefined {
  let anchor = group.repo
  let anchorRank = anchor ? (repoOrder?.get(anchor.id) ?? Number.POSITIVE_INFINITY) : undefined
  for (const repoId of group.repoIds) {
    const repo = repoMap.get(repoId)
    if (!repo) {
      continue
    }
    const rank = repoOrder?.get(repoId) ?? Number.POSITIVE_INFINITY
    if (!anchor || rank < (anchorRank ?? Number.POSITIVE_INFINITY)) {
      anchor = repo
      anchorRank = rank
    }
  }
  return anchor
}

export function sortProjectEntries(
  entries: OrderedGroupEntry[],
  projectOrderBy: ProjectOrderBy,
  repoOrder: Map<string, number> | undefined
): OrderedGroupEntry[] {
  if (projectOrderBy === 'recent') {
    return [...entries].sort((a, b) => {
      const byRecent = compareRecentProjectRank(a, b)
      if (byRecent !== 0) {
        return byRecent
      }
      const ma = manualRankForEntry(a, repoOrder)
      const mb = manualRankForEntry(b, repoOrder)
      if (ma !== mb) {
        return ma - mb
      }
      return a[1].label.localeCompare(b[1].label)
    })
  }
  if (!repoOrder) {
    return entries
  }
  return [...entries].sort((a, b) => {
    const ra = manualRankForEntry(a, repoOrder)
    const rb = manualRankForEntry(b, repoOrder)
    if (ra !== rb) {
      return ra - rb
    }
    return a[1].label.localeCompare(b[1].label)
  })
}

export function sortRepoEntriesWithinProjectGroup(args: {
  entries: OrderedGroupEntry[]
  projectOrderBy: ProjectOrderBy
  repoOrder: Map<string, number> | undefined
}): OrderedGroupEntry[] {
  if (args.projectOrderBy === 'recent') {
    return [...args.entries].sort(compareRecentProjectRank)
  }
  return [...args.entries].sort((left, right) => {
    const leftRank = getEffectiveProjectGroupManualRank(left[1].repo, args.repoOrder)
    const rightRank = getEffectiveProjectGroupManualRank(right[1].repo, args.repoOrder)
    return leftRank - rightRank
  })
}

import type { RuntimeWorkspaceListModelResult } from '../../../src/shared/runtime-types'
import { pickResumeWorktree, type ResumeCandidate } from './resume-worktree'

export type HomeWorktreeListModelSummary = ResumeCandidate & {
  worktreeId: string
}

// Statuses the desktop counts as "active" for a host's activity badge.
const ACTIVE_HOME_WORKTREE_STATUSES = ['working', 'active', 'permission']

export type HomeHostWorktreeSummary<T> = {
  orderedWorktrees: T[]
  totalWorktrees: number
  activeCount: number
  lastActiveWorktree: T | null
}

// Order a host's worktrees by the shared model and derive its home-screen
// activity summary (totals, active count, resume target) in one pass.
export function summarizeHomeHostWorktrees<
  T extends HomeWorktreeListModelSummary & { status?: string }
>(
  worktrees: readonly T[],
  model: RuntimeWorkspaceListModelResult | null
): HomeHostWorktreeSummary<T> {
  return {
    orderedWorktrees: orderWorktreesByWorkspaceListModel(worktrees, model),
    totalWorktrees: worktrees.length,
    activeCount: worktrees.filter(
      (worktree) => worktree.status && ACTIVE_HOME_WORKTREE_STATUSES.includes(worktree.status)
    ).length,
    lastActiveWorktree: pickResumeWorktreeForHome(worktrees, model)
  }
}

function orderedWorkspaceIdsFromListModel(model: RuntimeWorkspaceListModelResult): string[] {
  const orderedIds = model.rows.flatMap((row) => {
    if (row.type === 'item') {
      return [row.worktree.id]
    }
    if (row.type === 'folder-workspace') {
      return [`folder:${row.folderWorkspace.id}`]
    }
    return []
  })
  return orderedIds.length > 0 ? orderedIds : model.visibleWorktreeIds
}

export function orderWorktreesByWorkspaceListModel<T extends HomeWorktreeListModelSummary>(
  worktrees: readonly T[],
  model: RuntimeWorkspaceListModelResult | null
): T[] {
  if (!model) {
    return [...worktrees]
  }
  const worktreesById = new Map(worktrees.map((worktree) => [worktree.worktreeId, worktree]))
  const ordered: T[] = []
  const seen = new Set<string>()
  for (const worktreeId of orderedWorkspaceIdsFromListModel(model)) {
    const worktree = worktreesById.get(worktreeId)
    if (!worktree || seen.has(worktreeId)) {
      continue
    }
    ordered.push(worktree)
    seen.add(worktreeId)
  }
  for (const worktree of worktrees) {
    if (!seen.has(worktree.worktreeId)) {
      ordered.push(worktree)
    }
  }
  return ordered
}

export function pickResumeWorktreeForHome<T extends HomeWorktreeListModelSummary>(
  worktrees: readonly T[],
  model: RuntimeWorkspaceListModelResult | null
): T | null {
  const ordered = orderWorktreesByWorkspaceListModel(worktrees, model)
  if (model) {
    return ordered.find((worktree) => worktree.isActive) ?? ordered[0] ?? null
  }
  return pickResumeWorktree(ordered)
}

import type { Worktree } from '../types'
import type { WorkspaceReviewGroupKey, WorkspaceReviewState } from './workspace-list-model'

export const REVIEW_GROUP_ORDER: WorkspaceReviewGroupKey[] = [
  'done',
  'in-review',
  'in-progress',
  'closed'
]

export const REVIEW_GROUP_LABELS: Record<WorkspaceReviewGroupKey, string> = {
  done: 'Done',
  'in-review': 'In review',
  'in-progress': 'In progress',
  closed: 'Closed'
}

export function reviewGroupFromProviderState(
  state: string | null | undefined
): WorkspaceReviewGroupKey {
  const normalized = state?.trim().toLowerCase()
  if (normalized === 'merged') {
    return 'done'
  }
  if (normalized === 'closed') {
    return 'closed'
  }
  if (normalized === 'draft' || normalized === 'unknown' || !normalized) {
    return 'in-progress'
  }
  return 'in-review'
}

export function getWorkspaceReviewGroupKey(
  worktree: Worktree,
  reviewStateByWorktreeId: Record<string, WorkspaceReviewState | undefined> | undefined
): WorkspaceReviewGroupKey {
  // Grouping is decided by the provider-neutral normalized DTO; worktrees with a
  // linked review but no resolved state, and worktrees with no review at all,
  // both sit in 'in-progress' (open work, not yet merged/closed).
  return reviewStateByWorktreeId?.[worktree.id]?.group ?? 'in-progress'
}

export function normalizeLinkedReviewState(args: {
  provider: WorkspaceReviewState['provider']
  reviewType?: WorkspaceReviewState['reviewType']
  number?: number | null
  state?: string | null
}): WorkspaceReviewState | null {
  if (args.number == null) {
    return null
  }
  return {
    provider: args.provider,
    reviewType: args.reviewType ?? (args.provider === 'gitlab' ? 'mr' : 'pr'),
    number: args.number,
    state: args.state ?? null,
    group: reviewGroupFromProviderState(args.state)
  }
}

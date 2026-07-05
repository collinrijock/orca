import type { Worktree } from './workspace-list-types'

type SleepCandidate = Pick<Worktree, 'worktreeId' | 'liveTerminalCount'>

export function reconcilePendingSleepWorkspaceIds(
  pendingIds: ReadonlySet<string>,
  worktrees: readonly SleepCandidate[]
): Set<string> {
  if (pendingIds.size === 0) {
    return new Set()
  }
  const worktreeById = new Map(worktrees.map((worktree) => [worktree.worktreeId, worktree]))
  const stillPending = new Set<string>()
  for (const id of pendingIds) {
    const worktree = worktreeById.get(id)
    if (worktree && worktree.liveTerminalCount > 0) {
      stillPending.add(id)
    }
  }
  return stillPending
}

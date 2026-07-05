import type { Worktree } from './workspace-list-types'

export function applyMobileWorktreeDisplayOverrides(args: {
  worktrees: readonly Worktree[]
  sleptIds: ReadonlySet<string>
  optimisticActiveWorktreeId: string | null
}): Worktree[] {
  if (args.sleptIds.size === 0 && args.optimisticActiveWorktreeId === null) {
    return [...args.worktrees]
  }
  return args.worktrees.map((worktree) => {
    const slept = args.sleptIds.has(worktree.worktreeId)
      ? { liveTerminalCount: 0, hasAttachedPty: false, status: 'inactive' as const }
      : null
    const active =
      args.optimisticActiveWorktreeId !== null
        ? { isActive: worktree.worktreeId === args.optimisticActiveWorktreeId }
        : null
    return slept || active ? { ...worktree, ...slept, ...active } : worktree
  })
}

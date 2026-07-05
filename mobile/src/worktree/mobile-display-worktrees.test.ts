import { describe, expect, it } from 'vitest'
import type { Worktree } from './workspace-list-types'
import { applyMobileWorktreeDisplayOverrides } from './mobile-display-worktrees'

function worktree(worktreeId: string): Worktree {
  return {
    workspaceKind: 'git',
    worktreeId,
    repoId: 'repo-1',
    repo: 'repo',
    branch: 'feature',
    displayName: worktreeId,
    path: `/tmp/${worktreeId}`,
    liveTerminalCount: 1,
    hasAttachedPty: true,
    preview: '',
    unread: false,
    isPinned: false,
    linkedPR: null,
    status: 'active',
    agents: []
  }
}

describe('applyMobileWorktreeDisplayOverrides', () => {
  it('applies optimistic sleep and active row overrides', () => {
    const rows = applyMobileWorktreeDisplayOverrides({
      worktrees: [worktree('alpha'), worktree('beta')],
      sleptIds: new Set(['alpha']),
      optimisticActiveWorktreeId: 'beta'
    })

    expect(
      rows.map((row) => [row.worktreeId, row.status, row.liveTerminalCount, row.isActive])
    ).toEqual([
      ['alpha', 'inactive', 0, false],
      ['beta', 'active', 1, true]
    ])
  })
})

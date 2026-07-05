import { describe, expect, it } from 'vitest'
import { reconcilePendingSleepWorkspaceIds } from './pending-sleep-workspace-ids'

describe('reconcilePendingSleepWorkspaceIds', () => {
  it('keeps ids pending until the host reports their terminals inactive', () => {
    expect([
      ...reconcilePendingSleepWorkspaceIds(new Set(['active', 'inactive', 'missing']), [
        { worktreeId: 'active', liveTerminalCount: 1 },
        { worktreeId: 'inactive', liveTerminalCount: 0 }
      ])
    ]).toEqual(['active'])
  })
})

import { describe, expect, it } from 'vitest'
import type { RuntimeWorkspaceListModelResult } from '../../../src/shared/runtime-types'
import type { WorkspaceListRow } from '../../../src/shared/workspace-list/workspace-list-model'
import {
  orderWorktreesByWorkspaceListModel,
  pickResumeWorktreeForHome
} from './home-worktree-list-model'

type Summary = {
  worktreeId: string
  isActive?: boolean
  lastOutputAt?: number
}

function itemRow(worktreeId: string): WorkspaceListRow {
  return {
    type: 'item',
    rowKey: `all:${worktreeId}`,
    sectionKey: 'all',
    worktree: { id: worktreeId },
    repo: undefined,
    depth: 0,
    groupDepth: 0,
    lineageTrail: [],
    isLastLineageChild: false,
    lineageChildCount: 0
  } as WorkspaceListRow
}

function folderRow(folderWorkspaceId: string): WorkspaceListRow {
  return {
    type: 'folder-workspace',
    key: `folder-workspace:${folderWorkspaceId}`,
    folderWorkspace: { id: folderWorkspaceId },
    projectGroup: { id: 'group-1' },
    depth: 0,
    groupDepth: 0
  } as WorkspaceListRow
}

function model(
  visibleWorktreeIds: string[],
  rows: WorkspaceListRow[] = visibleWorktreeIds.map(itemRow)
): RuntimeWorkspaceListModelResult {
  return {
    modelVersion: 1,
    generatedAt: 0,
    preferences: {
      groupBy: 'workspace-status',
      sortBy: 'smart',
      projectOrderBy: 'manual',
      collapsedGroups: [],
      filterRepoIds: [],
      showSleepingWorkspaces: true,
      hideDefaultBranchWorkspace: false,
      hideAutomationGeneratedWorkspaces: false,
      workspaceHostScope: 'all'
    },
    sortedWorktreeIds: visibleWorktreeIds,
    visibleWorktreeIds,
    rows,
    totalRowCount: rows.length,
    agentsByWorktreeId: {},
    sourceCompletenessWarnings: [],
    truncated: false
  }
}

describe('home worktree list model ordering', () => {
  it('orders summaries by shared visible worktree ids and appends missing summaries', () => {
    const worktrees: Summary[] = [
      { worktreeId: 'alpha' },
      { worktreeId: 'beta' },
      { worktreeId: 'gamma' }
    ]

    expect(orderWorktreesByWorkspaceListModel(worktrees, model(['beta', 'alpha']))).toEqual([
      { worktreeId: 'beta' },
      { worktreeId: 'alpha' },
      { worktreeId: 'gamma' }
    ])
  })

  it('orders folder workspaces by shared row position on the home screen', () => {
    const worktrees: Summary[] = [
      { worktreeId: 'alpha' },
      { worktreeId: 'folder:docs' },
      { worktreeId: 'beta' }
    ]

    expect(
      orderWorktreesByWorkspaceListModel(
        worktrees,
        model(['beta', 'alpha'], [itemRow('beta'), folderRow('docs'), itemRow('alpha')])
      )
    ).toEqual([{ worktreeId: 'beta' }, { worktreeId: 'folder:docs' }, { worktreeId: 'alpha' }])
  })

  it('uses shared order for the home resume fallback when no workspace is active', () => {
    const worktrees: Summary[] = [
      { worktreeId: 'alpha', lastOutputAt: 100 },
      { worktreeId: 'beta', lastOutputAt: 10 }
    ]

    expect(pickResumeWorktreeForHome(worktrees, model(['beta', 'alpha']))?.worktreeId).toBe('beta')
  })

  it('keeps the legacy active/last-output heuristic when the shared model is unavailable', () => {
    const worktrees: Summary[] = [
      { worktreeId: 'alpha', lastOutputAt: 100 },
      { worktreeId: 'beta', lastOutputAt: 10 }
    ]

    expect(pickResumeWorktreeForHome(worktrees, null)?.worktreeId).toBe('alpha')
  })
})

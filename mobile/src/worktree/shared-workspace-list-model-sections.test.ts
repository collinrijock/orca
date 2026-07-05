import { describe, expect, it } from 'vitest'
import type {
  RuntimeWorkspaceListModelResult,
  RuntimeWorktreeAgentRow
} from '../../../src/shared/runtime-types'
import type {
  WorkspaceAgentRow,
  WorkspaceListRow
} from '../../../src/shared/workspace-list/workspace-list-model'
import { buildMobileSectionsFromWorkspaceListModel } from './shared-workspace-list-model-sections'
import type { Worktree } from './workspace-list-types'

function worktree(overrides: Partial<Worktree> = {}): Worktree {
  return {
    workspaceKind: 'git',
    worktreeId: 'alpha',
    repoId: 'repo-1',
    repo: 'orca',
    branch: 'feature/alpha',
    displayName: 'Alpha',
    path: '/tmp/orca/alpha',
    liveTerminalCount: 0,
    hasAttachedPty: false,
    preview: '',
    unread: false,
    isPinned: false,
    linkedPR: null,
    status: 'inactive',
    agents: [],
    ...overrides
  }
}

function sharedWorktree(worktreeId: string, displayName: string, repoId = 'repo-1') {
  return {
    id: worktreeId,
    repoId,
    displayName,
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    linkedGitLabMR: null,
    linkedGitLabIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 0,
    workspaceStatus: 'in-progress',
    path: `/tmp/orca/${worktreeId}`,
    head: '',
    branch: `feature/${worktreeId}`,
    isBare: false,
    isSparse: false,
    isMainWorktree: false
  }
}

function header(key: string, label: string, count: number): WorkspaceListRow {
  return {
    type: 'header',
    key,
    label,
    count,
    visual: key === 'pinned' ? 'pinned' : 'workspace-status'
  }
}

function item(worktreeId: string, sectionKey: string, rowKey = `${sectionKey}:${worktreeId}`) {
  return {
    type: 'item',
    rowKey,
    sectionKey,
    worktree: sharedWorktree(worktreeId, worktreeId),
    repo: { id: 'repo-1', displayName: 'orca' },
    depth: 0,
    groupDepth: 0,
    lineageTrail: [],
    isLastLineageChild: false,
    lineageChildCount: 0
  } as WorkspaceListRow
}

function model(args: {
  rows: WorkspaceListRow[]
  visibleWorktreeIds: string[]
  agentsByWorktreeId?: Record<string, WorkspaceAgentRow[]>
}): RuntimeWorkspaceListModelResult {
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
    sortedWorktreeIds: args.visibleWorktreeIds,
    visibleWorktreeIds: args.visibleWorktreeIds,
    rows: args.rows,
    totalRowCount: args.rows.length,
    agentsByWorktreeId: args.agentsByWorktreeId ?? {},
    sourceCompletenessWarnings: [],
    truncated: false
  }
}

function workspaceAgentRow(
  paneKey: string,
  overrides: Partial<WorkspaceAgentRow> = {}
): WorkspaceAgentRow {
  return {
    paneKey,
    entry: {
      state: 'working',
      prompt: `prompt ${paneKey}`,
      updatedAt: 20,
      stateStartedAt: 10,
      paneKey,
      stateHistory: []
    },
    tab: { id: 'tab-1', sortOrder: 0, createdAt: 0 },
    agentType: 'codex',
    rowSource: 'live',
    state: 'working',
    startedAt: 10,
    lineage: {
      depth: 0,
      isFirstSibling: true,
      isLastSibling: true,
      childCount: 0
    },
    ...overrides
  } as WorkspaceAgentRow
}

describe('buildMobileSectionsFromWorkspaceListModel', () => {
  it('uses shared model row order instead of local worktree order', () => {
    const sections = buildMobileSectionsFromWorkspaceListModel({
      model: model({
        rows: [
          header('workspace-status:in-progress', 'In progress', 2),
          item('beta', 'workspace-status:in-progress'),
          item('alpha', 'workspace-status:in-progress')
        ],
        visibleWorktreeIds: ['beta', 'alpha']
      }),
      displayWorktrees: [
        worktree({ worktreeId: 'alpha', displayName: 'Alpha' }),
        worktree({ worktreeId: 'beta', displayName: 'Beta', branch: 'feature/beta' })
      ],
      search: ''
    })

    expect(sections).toHaveLength(1)
    expect(sections[0]?.count).toBe(2)
    expect(sections[0]?.data.map((row) => row.worktreeId)).toEqual(['beta', 'alpha'])
  })

  it('maps shared agent rows into mobile rows without reordering them', () => {
    const root = workspaceAgentRow('root', {
      lineage: { depth: 0, isFirstSibling: true, isLastSibling: true, childCount: 1 }
    })
    const child = workspaceAgentRow('child', {
      lineage: { depth: 1, isFirstSibling: true, isLastSibling: true, childCount: 0 }
    })

    const sections = buildMobileSectionsFromWorkspaceListModel({
      model: model({
        rows: [
          header('workspace-status:in-progress', 'In progress', 1),
          item('alpha', 'workspace-status:in-progress')
        ],
        visibleWorktreeIds: ['alpha'],
        agentsByWorktreeId: { alpha: [root, child] }
      }),
      displayWorktrees: [worktree({ worktreeId: 'alpha' })],
      search: ''
    })

    const agents = sections[0]?.data[0]?.agents as RuntimeWorktreeAgentRow[]
    expect(agents.map((agent) => agent.paneKey)).toEqual(['root', 'child'])
    expect(agents.map((agent) => agent.parentPaneKey)).toEqual([null, 'root'])
  })

  it('preserves shared stale-decayed idle agent state for mobile rows', () => {
    const stale = workspaceAgentRow('stale', {
      state: 'idle',
      entry: {
        state: 'working',
        prompt: 'old prompt',
        updatedAt: 20,
        stateStartedAt: 10,
        paneKey: 'stale',
        stateHistory: []
      }
    })

    const sections = buildMobileSectionsFromWorkspaceListModel({
      model: model({
        rows: [
          header('workspace-status:in-progress', 'In progress', 1),
          item('alpha', 'workspace-status:in-progress')
        ],
        visibleWorktreeIds: ['alpha'],
        agentsByWorktreeId: { alpha: [stale] }
      }),
      displayWorktrees: [worktree({ worktreeId: 'alpha' })],
      search: ''
    })

    const agents = sections[0]?.data[0]?.agents as RuntimeWorktreeAgentRow[]
    expect(agents.map((agent) => agent.state)).toEqual(['idle'])
  })

  it('applies mobile search after shared grouping while preserving section shape', () => {
    const sections = buildMobileSectionsFromWorkspaceListModel({
      model: model({
        rows: [
          header('workspace-status:in-progress', 'In progress', 2),
          item('beta', 'workspace-status:in-progress'),
          item('alpha', 'workspace-status:in-progress')
        ],
        visibleWorktreeIds: ['beta', 'alpha']
      }),
      displayWorktrees: [
        worktree({ worktreeId: 'alpha', displayName: 'Alpha' }),
        worktree({ worktreeId: 'beta', displayName: 'Beta', branch: 'feature/beta' })
      ],
      search: 'alp'
    })

    expect(sections[0]?.count).toBe(1)
    expect(sections[0]?.data.map((row) => row.worktreeId)).toEqual(['alpha'])
  })

  it('drops group headers whose items all filter out during search', () => {
    const sections = buildMobileSectionsFromWorkspaceListModel({
      model: model({
        rows: [
          header('workspace-status:in-progress', 'In progress', 1),
          item('alpha', 'workspace-status:in-progress'),
          header('workspace-status:done', 'Done', 1),
          item('beta', 'workspace-status:done')
        ],
        visibleWorktreeIds: ['alpha', 'beta']
      }),
      displayWorktrees: [
        worktree({ worktreeId: 'alpha', displayName: 'Alpha' }),
        worktree({ worktreeId: 'beta', displayName: 'Beta', branch: 'feature/beta' })
      ],
      search: 'alp'
    })

    // The "Done" group matched nothing, so its header must not render as an
    // empty "Done 0" row — only the matching "In progress" group survives.
    expect(sections.map((section) => section.title)).toEqual(['In progress'])
    expect(sections[0]?.data.map((row) => row.worktreeId)).toEqual(['alpha'])
  })
})

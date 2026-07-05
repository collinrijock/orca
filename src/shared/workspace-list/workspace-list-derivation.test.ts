import { expect, it } from 'vitest'
import { AGENT_STATUS_STALE_AFTER_MS, type AgentStatusEntry } from '../agent-status-types'
import { LOCAL_EXECUTION_HOST_ID, toSshExecutionHostId } from '../execution-host'
import { makePaneKey } from '../stable-pane-id'
import type {
  Project,
  ProjectHostSetup,
  Repo,
  TerminalTab,
  Worktree,
  WorktreeLineage
} from '../types'
import { cloneDefaultWorkspaceStatuses } from '../workspace-statuses'
import { deriveWorkspaceListModel } from './workspace-list-derivation'
import type { WorkspaceListInput, WorkspaceListPreferences } from './workspace-list-model'
import { normalizeLinkedReviewState } from './workspace-review-state'

const NOW = 1_700_000_000_000
const LEAF_ONE = '11111111-1111-4111-8111-111111111111'
const LEAF_TWO = '22222222-2222-4222-8222-222222222222'

function repo(overrides: Partial<Repo> & Pick<Repo, 'id'>): Repo {
  const { id, ...rest } = overrides
  return {
    id,
    path: `/repo/${id}`,
    displayName: overrides.displayName ?? id,
    badgeColor: 'blue',
    addedAt: 0,
    ...rest
  }
}

function worktree(overrides: Partial<Worktree> & Pick<Worktree, 'id' | 'repoId'>): Worktree {
  const { id, repoId, ...rest } = overrides
  return {
    id,
    instanceId: `${id}:instance`,
    repoId,
    path: `/repo/${repoId}/worktrees/${id}`,
    head: 'abc123',
    branch: 'refs/heads/feature',
    isBare: false,
    isMainWorktree: false,
    displayName: id,
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 0,
    ...rest
  }
}

function tab(id: string, worktreeId: string, leafId = LEAF_ONE): TerminalTab {
  return {
    id,
    ptyId: `pty-${id}`,
    worktreeId,
    title: 'Terminal',
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: NOW - 10_000,
    defaultTitle: 'Terminal',
    startupCwd: `/tmp/${leafId}`
  }
}

function statusEntry(args: {
  tabId: string
  leafId?: string
  state: AgentStatusEntry['state']
  stateStartedAt: number
  updatedAt?: number
  parentPaneKey?: string
}): AgentStatusEntry {
  const paneKey = makePaneKey(args.tabId, args.leafId ?? LEAF_ONE)
  return {
    paneKey,
    state: args.state,
    prompt: 'Fix the thing',
    updatedAt: args.updatedAt ?? NOW,
    stateStartedAt: args.stateStartedAt,
    stateHistory: [],
    agentType: 'codex',
    ...(args.parentPaneKey
      ? {
          orchestration: {
            taskId: 'task-1',
            dispatchId: 'dispatch-1',
            parentPaneKey: args.parentPaneKey
          }
        }
      : {})
  }
}

function preferences(overrides: Partial<WorkspaceListPreferences> = {}): WorkspaceListPreferences {
  return {
    groupBy: 'none',
    sortBy: 'recent',
    projectOrderBy: 'manual',
    collapsedGroups: [],
    filterRepoIds: [],
    showSleepingWorkspaces: true,
    hideDefaultBranchWorkspace: false,
    hideAutomationGeneratedWorkspaces: false,
    workspaceHostScope: 'all',
    visibleWorkspaceHostIds: null,
    workspaceHostOrder: [],
    ...overrides
  }
}

function input(overrides: Partial<WorkspaceListInput>): WorkspaceListInput {
  const repos = overrides.repos ?? [repo({ id: 'repo-1', displayName: 'Repo 1' })]
  return {
    preferences: preferences(),
    repos,
    worktreesByRepo: {},
    workspaceStatuses: cloneDefaultWorkspaceStatuses(),
    defaultHostId: LOCAL_EXECUTION_HOST_ID,
    ...overrides
  }
}

function itemKeys(rows: ReturnType<typeof deriveWorkspaceListModel>['rows']): string[] {
  return rows.flatMap((row) => (row.type === 'item' ? [row.rowKey] : []))
}

it('orders Smart rows by shared agent attention and derives inline agent rows', () => {
  const blocked = worktree({
    id: 'blocked',
    repoId: 'repo-1',
    sortOrder: 1,
    lastActivityAt: NOW - 100_000
  })
  const recent = worktree({
    id: 'recent',
    repoId: 'repo-1',
    sortOrder: 2,
    lastActivityAt: NOW - 1_000
  })
  const blockedTab = tab('tab-blocked', blocked.id)
  const recentTab = tab('tab-recent', recent.id, LEAF_TWO)
  const entry = statusEntry({
    tabId: blockedTab.id,
    state: 'waiting',
    stateStartedAt: NOW - 5_000
  })

  const model = deriveWorkspaceListModel(
    input({
      preferences: preferences({ sortBy: 'smart' }),
      worktreesByRepo: { 'repo-1': [recent, blocked] },
      tabsByWorktree: { [blocked.id]: [blockedTab], [recent.id]: [recentTab] },
      ptyIdsByTabId: {
        [blockedTab.id]: ['pty-blocked'],
        [recentTab.id]: ['pty-recent']
      },
      agentStatusByPaneKey: { [entry.paneKey]: entry }
    }),
    NOW
  )

  expect(model.sortedWorktreeIds).toEqual(['blocked', 'recent'])
  expect(itemKeys(model.rows)).toEqual(['all:blocked', 'all:recent'])
  expect(model.agentsByWorktreeId.blocked).toMatchObject([
    {
      paneKey: entry.paneKey,
      rowSource: 'live',
      state: 'waiting',
      agentType: 'codex'
    }
  ])
})

it('keeps visible lineage ancestors when sleeping workspaces are hidden', () => {
  const parent = worktree({ id: 'parent', repoId: 'repo-1', sortOrder: 1 })
  const child = worktree({ id: 'child', repoId: 'repo-1', sortOrder: 2 })
  const childTab = tab('tab-child', child.id)
  const lineage: WorktreeLineage = {
    worktreeId: child.id,
    worktreeInstanceId: child.instanceId!,
    parentWorktreeId: parent.id,
    parentWorktreeInstanceId: parent.instanceId!,
    origin: 'manual',
    capture: { confidence: 'explicit', source: 'manual-action' },
    createdAt: NOW
  }

  const model = deriveWorkspaceListModel(
    input({
      preferences: preferences({
        sortBy: 'manual',
        showSleepingWorkspaces: false
      }),
      worktreesByRepo: { 'repo-1': [child, parent] },
      tabsByWorktree: { [child.id]: [childTab] },
      ptyIdsByTabId: { [childTab.id]: ['pty-child'] },
      worktreeLineageById: { [child.id]: lineage }
    }),
    NOW
  )

  expect(model.visibleWorktreeIds).toEqual(['parent', 'child'])
  expect(
    model.rows.filter((row) => row.type === 'item').map((row) => [row.worktree.id, row.depth])
  ).toEqual([
    ['parent', 0],
    ['child', 1]
  ])
})

it('keeps browser-only workspaces visible when sleeping workspaces are hidden', () => {
  const browserOnly = worktree({ id: 'browser-only', repoId: 'repo-1', sortOrder: 1 })
  const sleeping = worktree({ id: 'sleeping', repoId: 'repo-1', sortOrder: 2 })

  const model = deriveWorkspaceListModel(
    input({
      preferences: preferences({
        sortBy: 'manual',
        showSleepingWorkspaces: false
      }),
      worktreesByRepo: { 'repo-1': [browserOnly, sleeping] },
      browserTabsByWorktree: { [browserOnly.id]: [{ id: 'browser-page-1' }] }
    }),
    NOW
  )

  expect(model.visibleWorktreeIds).toEqual(['browser-only'])
  expect(itemKeys(model.rows)).toEqual(['all:browser-only'])
})

it('uses host section order and persisted host collapse keys', () => {
  const sshHostId = toSshExecutionHostId('remote-1')
  const localRepo = repo({ id: 'local-repo', displayName: 'Local repo' })
  const sshRepo = repo({
    id: 'ssh-repo',
    displayName: 'SSH repo',
    connectionId: 'remote-1'
  })
  const local = worktree({ id: 'local', repoId: localRepo.id, sortOrder: 2 })
  const remote = worktree({ id: 'remote', repoId: sshRepo.id, sortOrder: 1 })

  const model = deriveWorkspaceListModel(
    input({
      preferences: preferences({
        sortBy: 'manual',
        collapsedGroups: [`host:${sshHostId}`],
        visibleWorkspaceHostIds: [LOCAL_EXECUTION_HOST_ID, sshHostId],
        workspaceHostOrder: [sshHostId, LOCAL_EXECUTION_HOST_ID]
      }),
      repos: [localRepo, sshRepo],
      worktreesByRepo: {
        [localRepo.id]: [local],
        [sshRepo.id]: [remote]
      },
      hostOptions: [
        {
          id: LOCAL_EXECUTION_HOST_ID,
          kind: 'local',
          label: 'Local',
          detail: 'This computer',
          health: 'local'
        },
        {
          id: sshHostId,
          kind: 'ssh',
          label: 'Remote 1',
          detail: 'SSH',
          health: 'available',
          connectionStatus: 'connected'
        }
      ]
    }),
    NOW
  )

  expect(
    model.rows.map((row) =>
      row.type === 'host-header'
        ? `${row.key}:${row.collapsed ? 'collapsed' : 'expanded'}`
        : row.type === 'item'
          ? row.worktree.id
          : row.key
    )
  ).toEqual([`host:${sshHostId}:collapsed`, 'host:local:expanded', 'all', 'local'])
})

it('includes host context labels for mixed-host project sections', () => {
  const sshHostId = toSshExecutionHostId('gpu-vm')
  const localRepo = repo({ id: 'repo-local', displayName: 'orca', path: '/tmp/orca' })
  const remoteRepo = repo({
    id: 'repo-remote',
    displayName: 'orca',
    path: '/home/alice/orca',
    connectionId: 'gpu-vm'
  })
  const local = worktree({ id: 'local', repoId: localRepo.id, sortOrder: 2 })
  const remote = worktree({ id: 'remote', repoId: remoteRepo.id, sortOrder: 1 })
  const project: Project = {
    id: 'github:stablyai/orca',
    displayName: 'Orca',
    badgeColor: 'blue',
    sourceRepoIds: [localRepo.id, remoteRepo.id],
    createdAt: 1,
    updatedAt: 1
  }
  const projectHostSetups: ProjectHostSetup[] = [
    {
      id: 'setup-local',
      projectId: project.id,
      hostId: LOCAL_EXECUTION_HOST_ID,
      repoId: localRepo.id,
      path: localRepo.path,
      displayName: localRepo.displayName,
      setupState: 'ready',
      setupMethod: 'legacy-repo',
      createdAt: 1,
      updatedAt: 1
    },
    {
      id: 'setup-remote',
      projectId: project.id,
      hostId: sshHostId,
      repoId: remoteRepo.id,
      path: remoteRepo.path,
      displayName: remoteRepo.displayName,
      setupState: 'ready',
      setupMethod: 'legacy-repo',
      createdAt: 1,
      updatedAt: 1
    }
  ]

  const model = deriveWorkspaceListModel(
    input({
      preferences: preferences({ groupBy: 'repo', sortBy: 'manual' }),
      repos: [localRepo, remoteRepo],
      worktreesByRepo: {
        [localRepo.id]: [local],
        [remoteRepo.id]: [remote]
      },
      projectGrouping: { projects: [project], projectHostSetups },
      hostOptions: [
        {
          id: LOCAL_EXECUTION_HOST_ID,
          kind: 'local',
          label: 'Local host',
          detail: 'This computer',
          health: 'local'
        },
        {
          id: sshHostId,
          kind: 'ssh',
          label: 'gpu-vm',
          detail: 'SSH',
          health: 'available'
        }
      ]
    }),
    NOW
  )

  expect(
    model.rows
      .filter((row) => row.type === 'item')
      .map((row) => [row.worktree.id, row.hostContextLabel])
  ).toEqual([
    ['local', 'Local host'],
    ['remote', 'gpu-vm']
  ])
})

it('groups provider-neutral review states before rendering adapters attach provider UI', () => {
  const github = worktree({ id: 'github', repoId: 'repo-1', linkedPR: 12 })
  const gitlab = worktree({ id: 'gitlab', repoId: 'repo-1', linkedGitLabMR: 7 })

  const model = deriveWorkspaceListModel(
    input({
      preferences: preferences({ groupBy: 'pr-status', sortBy: 'name' }),
      worktreesByRepo: { 'repo-1': [github, gitlab] },
      reviewStateByWorktreeId: {
        github: normalizeLinkedReviewState({
          provider: 'github',
          number: 12,
          state: 'open'
        })!,
        gitlab: normalizeLinkedReviewState({
          provider: 'gitlab',
          reviewType: 'mr',
          number: 7,
          state: 'merged'
        })!
      }
    }),
    NOW
  )

  expect(model.rows.map((row) => (row.type === 'item' ? row.worktree.id : row.key))).toEqual([
    'pr:done',
    'gitlab',
    'pr:in-review',
    'github'
  ])
})

it('decays stale live agent rows while keeping retained done rows ordered deterministically', () => {
  const active = worktree({ id: 'active', repoId: 'repo-1' })
  const activeTab = tab('tab-active', active.id)
  const staleEntry = statusEntry({
    tabId: activeTab.id,
    state: 'working',
    stateStartedAt: NOW - AGENT_STATUS_STALE_AFTER_MS - 10_000,
    updatedAt: NOW - AGENT_STATUS_STALE_AFTER_MS - 1_000
  })
  const retainedEntry = statusEntry({
    tabId: activeTab.id,
    leafId: LEAF_TWO,
    state: 'done',
    stateStartedAt: NOW - AGENT_STATUS_STALE_AFTER_MS - 20_000
  })

  const model = deriveWorkspaceListModel(
    input({
      worktreesByRepo: { 'repo-1': [active] },
      tabsByWorktree: { [active.id]: [activeTab] },
      ptyIdsByTabId: { [activeTab.id]: ['pty-active'] },
      agentStatusByPaneKey: { [staleEntry.paneKey]: staleEntry },
      retainedAgentsByPaneKey: {
        [retainedEntry.paneKey]: {
          entry: retainedEntry,
          worktreeId: active.id,
          tab: activeTab,
          agentType: 'codex',
          startedAt: NOW - AGENT_STATUS_STALE_AFTER_MS - 20_000
        }
      }
    }),
    NOW
  )

  expect(
    model.agentsByWorktreeId.active.map((row) => [row.paneKey, row.rowSource, row.state])
  ).toEqual([
    [retainedEntry.paneKey, 'retained', 'done'],
    [staleEntry.paneKey, 'live', 'idle']
  ])
})

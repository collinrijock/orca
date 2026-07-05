import { describe, expect, it } from 'vitest'
import { LOCAL_EXECUTION_HOST_ID, toSshExecutionHostId } from '../../../../shared/execution-host'
import type { Repo, Worktree } from '../../../../shared/types'
import { cloneDefaultWorkspaceStatuses } from '../../../../shared/workspace-statuses'
import { deriveWorkspaceListModel } from '../../../../shared/workspace-list/workspace-list-derivation'
import type {
  WorkspaceHostOption,
  WorkspaceListRow
} from '../../../../shared/workspace-list/workspace-list-model'
import { addHostSectionRows, type HostSectionRow } from './host-section-rows'
import { buildRows, type Row } from './worktree-list-groups'

const NOW = 1_700_000_000_000

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

function rendererRowSignature(row: HostSectionRow): string {
  switch (row.type) {
    case 'host-header':
      return `${row.key}:${row.collapsed ? 'collapsed' : 'expanded'}`
    case 'header':
      return row.key
    case 'item':
      return row.rowKey
    case 'pending-creation':
    case 'imported-worktrees-card':
    case 'new-external-worktrees-inbox':
    case 'folder-workspace':
      return row.key
  }
}

function sharedRowSignature(row: WorkspaceListRow): string {
  switch (row.type) {
    case 'host-header':
      return `${row.key}:${row.collapsed ? 'collapsed' : 'expanded'}`
    case 'header':
      return row.key
    case 'item':
      return row.rowKey
    case 'pending-creation':
    case 'imported-worktrees-card':
    case 'new-external-worktrees-inbox':
    case 'folder-workspace':
      return row.key
  }
}

describe('workspace list shared model parity', () => {
  it('matches the desktop row builder for project grouping, host sections, and pending rows', () => {
    const sshHostId = toSshExecutionHostId('remote-1')
    const localRepo = repo({ id: 'local-repo', displayName: 'Local repo', addedAt: 1 })
    const sshRepo = repo({
      id: 'ssh-repo',
      displayName: 'SSH repo',
      addedAt: 2,
      connectionId: 'remote-1'
    })
    const localMain = worktree({
      id: 'local-main',
      repoId: localRepo.id,
      isMainWorktree: true,
      sortOrder: 1,
      lastActivityAt: NOW - 20_000
    })
    const localFeature = worktree({
      id: 'local-feature',
      repoId: localRepo.id,
      isPinned: true,
      sortOrder: 3,
      lastActivityAt: NOW - 10_000
    })
    const remoteFeature = worktree({
      id: 'remote-feature',
      repoId: sshRepo.id,
      sortOrder: 2,
      lastActivityAt: NOW - 5_000
    })
    const repos = [localRepo, sshRepo]
    const worktrees = [localMain, localFeature, remoteFeature]
    const repoMap = new Map(repos.map((entry) => [entry.id, entry]))
    const collapsedGroups = new Set<string>([`host:${sshHostId}`])
    const repoOrder = new Map(repos.map((entry, index) => [entry.id, index]))
    const workspaceStatuses = cloneDefaultWorkspaceStatuses()
    const hostOptions: WorkspaceHostOption[] = [
      {
        id: sshHostId,
        kind: 'ssh' as const,
        label: 'Remote 1',
        detail: 'SSH',
        health: 'available' as const,
        connectionStatus: 'connected' as const
      },
      {
        id: LOCAL_EXECUTION_HOST_ID,
        kind: 'local' as const,
        label: 'Local',
        detail: 'This computer',
        health: 'local' as const
      }
    ]
    const pendingCreations = [{ creationId: 'create-1', repoId: sshRepo.id }]

    const rendererRows = addHostSectionRows({
      rows: buildRows(
        'repo',
        worktrees,
        repoMap,
        null,
        collapsedGroups,
        repoOrder,
        workspaceStatuses,
        'manual',
        {},
        new Map(worktrees.map((entry) => [entry.id, entry])),
        true,
        undefined,
        [],
        new Set(),
        new Map(),
        new Map(),
        pendingCreations
      ) as Row[],
      hostOptions,
      workspaceHostScope: 'all',
      visibleWorkspaceHostIds: [sshHostId, LOCAL_EXECUTION_HOST_ID],
      defaultHostId: LOCAL_EXECUTION_HOST_ID,
      collapsedHostKeys: collapsedGroups,
      preferProjectGrouping: true
    })

    const sharedModel = deriveWorkspaceListModel(
      {
        preferences: {
          groupBy: 'repo',
          sortBy: 'manual',
          projectOrderBy: 'manual',
          collapsedGroups: [...collapsedGroups],
          filterRepoIds: [],
          showSleepingWorkspaces: true,
          hideDefaultBranchWorkspace: false,
          hideAutomationGeneratedWorkspaces: false,
          workspaceHostScope: 'all',
          visibleWorkspaceHostIds: [sshHostId, LOCAL_EXECUTION_HOST_ID],
          workspaceHostOrder: [sshHostId, LOCAL_EXECUTION_HOST_ID]
        },
        repos,
        worktreesByRepo: {
          [localRepo.id]: [localMain, localFeature],
          [sshRepo.id]: [remoteFeature]
        },
        workspaceStatuses,
        pendingCreations,
        hostOptions,
        defaultHostId: LOCAL_EXECUTION_HOST_ID
      },
      NOW
    )

    expect(rendererRows.map(rendererRowSignature)).toEqual(sharedModel.rows.map(sharedRowSignature))
  })
})

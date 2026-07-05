import {
  ALL_EXECUTION_HOSTS_SCOPE,
  LOCAL_EXECUTION_HOST_ID,
  getLocalExecutionHostLabel,
  getRepoExecutionHostId,
  type ExecutionHostId,
  type ExecutionHostScope
} from '../execution-host'
import type { FolderWorkspace, ProjectGroup, Repo } from '../types'
import { PINNED_GROUP_KEY } from './workspace-section-rows'
import type {
  WorkspaceHostHeaderRow,
  WorkspaceHostOption,
  WorkspaceListRow,
  WorkspaceSectionRow
} from './workspace-list-model'

function getRepoHostId(
  repo: Pick<Repo, 'connectionId' | 'executionHostId'> | undefined,
  defaultHostId: ExecutionHostId
): ExecutionHostId {
  if (repo?.connectionId || repo?.executionHostId) {
    return getRepoExecutionHostId(repo)
  }
  return defaultHostId
}

function getSshHostId(connectionId: string): ExecutionHostId {
  return `ssh:${encodeURIComponent(connectionId)}` as ExecutionHostId
}

function getFolderWorkspaceHostId(
  folderWorkspace: Pick<FolderWorkspace, 'connectionId'>,
  projectGroup: Pick<ProjectGroup, 'connectionId'>,
  defaultHostId: ExecutionHostId
): ExecutionHostId {
  const connectionId = folderWorkspace.connectionId ?? projectGroup.connectionId
  return connectionId ? getSshHostId(connectionId) : defaultHostId
}

function getRowHostId(
  row: WorkspaceSectionRow,
  defaultHostId: ExecutionHostId
): ExecutionHostId | null {
  switch (row.type) {
    case 'item':
      return getRepoHostId(row.repo, defaultHostId)
    case 'pending-creation':
    case 'imported-worktrees-card':
    case 'new-external-worktrees-inbox':
      return getRepoHostId(row.repo, defaultHostId)
    case 'folder-workspace':
      return getFolderWorkspaceHostId(row.folderWorkspace, row.projectGroup, defaultHostId)
    case 'header':
      return row.repo ? getRepoHostId(row.repo, defaultHostId) : null
  }
}

function getFallbackHost(hostId: ExecutionHostId): WorkspaceHostOption {
  const isLocal = hostId === LOCAL_EXECUTION_HOST_ID
  return {
    id: hostId,
    kind: isLocal ? 'local' : hostId.startsWith('ssh:') ? 'ssh' : 'runtime',
    label: isLocal ? getLocalExecutionHostLabel() : hostId,
    detail: isLocal ? 'This computer' : 'Host',
    health: isLocal ? 'local' : 'available'
  }
}

function countWorktreeRows(rows: readonly WorkspaceSectionRow[]): number {
  let count = 0
  const seenWorktreeIds = new Set<string>()
  let pendingHeaderCount: number | null = null
  let pendingHeaderHadItems = false
  const flushHeader = (): void => {
    if (pendingHeaderCount !== null && !pendingHeaderHadItems) {
      count += pendingHeaderCount
    }
    pendingHeaderCount = null
    pendingHeaderHadItems = false
  }
  for (const row of rows) {
    if (row.type === 'header') {
      flushHeader()
      pendingHeaderCount = row.key === PINNED_GROUP_KEY ? null : row.count
      continue
    }
    if (row.type === 'item') {
      if (!seenWorktreeIds.has(row.worktree.id)) {
        count += 1
        seenWorktreeIds.add(row.worktree.id)
      }
      pendingHeaderHadItems = pendingHeaderCount !== null
    }
  }
  flushHeader()
  return count
}

export function orderWorkspaceHostOptions(
  hostOptions: readonly WorkspaceHostOption[],
  workspaceHostOrder: readonly ExecutionHostId[] = []
): WorkspaceHostOption[] {
  if (workspaceHostOrder.length === 0 || hostOptions.length <= 1) {
    return [...hostOptions]
  }
  const hostById = new Map(hostOptions.map((host) => [host.id, host]))
  const ordered: WorkspaceHostOption[] = []
  const seen = new Set<ExecutionHostId>()
  for (const hostId of workspaceHostOrder) {
    const host = hostById.get(hostId)
    if (!host || seen.has(host.id)) {
      continue
    }
    ordered.push(host)
    seen.add(host.id)
  }
  for (const host of hostOptions) {
    if (seen.has(host.id)) {
      continue
    }
    ordered.push(host)
  }
  return ordered
}

export function addWorkspaceHostSectionRows(args: {
  rows: readonly WorkspaceSectionRow[]
  hostOptions: readonly WorkspaceHostOption[]
  workspaceHostScope: ExecutionHostScope
  visibleWorkspaceHostIds?: readonly ExecutionHostId[] | null
  defaultHostId: ExecutionHostId
  collapsedHostKeys?: ReadonlySet<string>
  forceCollapseHosts?: boolean
  preferProjectGrouping?: boolean
}): WorkspaceListRow[] {
  const visibleHostIds =
    args.visibleWorkspaceHostIds ??
    (args.workspaceHostScope === ALL_EXECUTION_HOSTS_SCOPE ? null : [args.workspaceHostScope])
  if (
    args.preferProjectGrouping &&
    args.workspaceHostScope === ALL_EXECUTION_HOSTS_SCOPE &&
    !args.visibleWorkspaceHostIds
  ) {
    return [...args.rows]
  }
  if ((visibleHostIds && visibleHostIds.length <= 1) || args.hostOptions.length <= 1) {
    return [...args.rows]
  }

  const hostOptionsById = new Map(args.hostOptions.map((host) => [host.id, host]))
  const rowsByHostId = new Map<ExecutionHostId, WorkspaceSectionRow[]>()
  const globalRows: WorkspaceSectionRow[] = []
  let pendingRows: Extract<WorkspaceSectionRow, { type: 'header' }>[] = []
  let pendingRowsWereUsed = false
  const pendingRowsKeyByHostId = new Map<ExecutionHostId, string>()

  for (const row of args.rows) {
    const rowHostId = getRowHostId(row, args.defaultHostId)
    if (rowHostId) {
      const hostRows = rowsByHostId.get(rowHostId) ?? []
      if (pendingRows.length > 0) {
        const pendingRowsKey = pendingRows.map((pendingRow) => pendingRow.key).join('\0')
        if (pendingRowsKeyByHostId.get(rowHostId) !== pendingRowsKey) {
          hostRows.push(...pendingRows)
          pendingRowsKeyByHostId.set(rowHostId, pendingRowsKey)
        }
        pendingRowsWereUsed = true
      }
      hostRows.push(row)
      rowsByHostId.set(rowHostId, hostRows)
      continue
    }
    if (row.type === 'header') {
      pendingRows = [row]
      pendingRowsWereUsed = false
    } else {
      globalRows.push(row)
    }
  }

  if (pendingRows.length > 0 && !pendingRowsWereUsed) {
    globalRows.push(...pendingRows)
  }

  const hostOrder: ExecutionHostId[] = []
  for (const host of args.hostOptions) {
    if (rowsByHostId.has(host.id)) {
      hostOrder.push(host.id)
    }
  }
  for (const hostId of rowsByHostId.keys()) {
    if (!hostOptionsById.has(hostId)) {
      hostOrder.push(hostId)
    }
  }

  if (rowsByHostId.size <= 1) {
    return [...args.rows]
  }

  const result: WorkspaceListRow[] = [...globalRows]
  for (const hostId of hostOrder) {
    const hostRows = rowsByHostId.get(hostId)
    if (!hostRows || hostRows.length === 0) {
      continue
    }
    const host = hostOptionsById.get(hostId) ?? getFallbackHost(hostId)
    const collapsed =
      args.forceCollapseHosts || (args.collapsedHostKeys?.has(`host:${host.id}`) ?? false)
    const header: WorkspaceHostHeaderRow = {
      type: 'host-header',
      key: `host:${host.id}`,
      hostId: host.id,
      kind: host.kind,
      label: host.label,
      detail: host.detail,
      health: host.health,
      compatibility: host.compatibility,
      connectionStatus: host.connectionStatus,
      collapsed,
      count: countWorktreeRows(hostRows)
    }
    result.push(header)
    if (!collapsed) {
      result.push(...hostRows)
    }
  }

  return result
}

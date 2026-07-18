import type { PersistedState, WorkspaceKey } from '../../shared/types'
import { parseWorkspaceKey } from '../../shared/workspace-scope'
import type { TransferProfileState } from './profile-project-state-file'
import {
  isRepoWorktreeId,
  rekeyWorktreeId,
  rekeyWorkspaceKey
} from './profile-project-worktree-identity'

export function collectTransferWorktreeIds(
  state: TransferProfileState,
  repoId: string
): Set<string> {
  const ids = new Set<string>()
  const add = (value: string | null | undefined): void => {
    if (value && isRepoWorktreeId(repoId, value)) {
      ids.add(value)
    }
  }
  Object.keys(state.worktreeMeta).forEach(add)
  for (const lineage of Object.values(state.worktreeLineageById)) {
    add(lineage.worktreeId)
    add(lineage.parentWorktreeId)
  }
  for (const [key, lineage] of Object.entries(state.workspaceLineageByChildKey)) {
    const child = parseWorkspaceKey(key)
    const parent = parseWorkspaceKey(lineage.parentWorkspaceKey)
    if (child?.type === 'worktree') {
      add(child.worktreeId)
    }
    if (parent?.type === 'worktree') {
      add(parent.worktreeId)
    }
  }
  collectSessionWorktreeIds(state.workspaceSession, repoId, ids)
  for (const session of Object.values(state.workspaceSessionsByHostId ?? {})) {
    collectSessionWorktreeIds(session, repoId, ids)
  }
  Object.keys(state.ui?.showDotfilesByWorktree ?? {}).forEach(add)
  return ids
}

function collectSessionWorktreeIds(
  session: PersistedState['workspaceSession'] | undefined,
  repoId: string,
  ids: Set<string>
): void {
  if (!session) {
    return
  }
  const add = (value: string | null | undefined): void => {
    if (value && isRepoWorktreeId(repoId, value)) {
      ids.add(value)
    }
  }
  const addOwnerKeys = (record: Record<string, unknown> | undefined): void => {
    for (const key of Object.keys(record ?? {})) {
      if (isRepoWorktreeId(repoId, key)) {
        ids.add(key)
      }
      const parsed = parseWorkspaceKey(key)
      if (parsed?.type === 'worktree' && isRepoWorktreeId(repoId, parsed.worktreeId)) {
        ids.add(parsed.worktreeId)
      }
    }
  }
  addOwnerKeys(session.tabsByWorktree)
  addOwnerKeys(session.openFilesByWorktree)
  addOwnerKeys(session.browserTabsByWorktree)
  addOwnerKeys(session.activeBrowserTabIdByWorktree)
  addOwnerKeys(session.activeTabTypeByWorktree)
  addOwnerKeys(session.activeTabIdByWorktree)
  addOwnerKeys(session.unifiedTabs)
  addOwnerKeys(session.tabGroups)
  addOwnerKeys(session.tabGroupLayouts)
  addOwnerKeys(session.activeGroupIdByWorktree)
  addOwnerKeys(session.lastVisitedAtByWorktreeId)
  addOwnerKeys(session.defaultTerminalTabsAppliedByWorktreeId)
  addOwnerKeys(session.activeFileIdByWorktree)
  for (const record of Object.values(session.sleepingAgentSessionsByPaneKey ?? {})) {
    add(record.worktreeId)
  }
  add(session.activeWorktreeId)
  const activeScope = session.activeWorkspaceKey
    ? parseWorkspaceKey(session.activeWorkspaceKey)
    : null
  if (activeScope?.type === 'worktree') {
    add(activeScope.worktreeId)
  }
}

export function rekeyWorktreeIdRecord<T>(
  record: Record<string, T>,
  worktreeIds: ReadonlySet<string>,
  oldRepoId: string,
  newRepoId: string,
  mapValue: (value: T) => T = (value) => structuredClone(value)
): Record<string, T> {
  const next: Record<string, T> = {}
  for (const [oldKey, value] of Object.entries(record)) {
    if (worktreeIds.has(oldKey)) {
      next[rekeyWorktreeId(oldRepoId, newRepoId, oldKey)] = mapValue(value)
    }
  }
  return next
}

export function rekeyWorktreeLineageRecord(
  record: PersistedState['worktreeLineageById'],
  worktreeIds: ReadonlySet<string>,
  oldRepoId: string,
  newRepoId: string
): PersistedState['worktreeLineageById'] {
  const next: PersistedState['worktreeLineageById'] = {}
  for (const [oldKey, lineage] of Object.entries(record)) {
    if (!worktreeIds.has(oldKey) && !worktreeIds.has(lineage.parentWorktreeId)) {
      continue
    }
    const newKey = rekeyWorktreeId(oldRepoId, newRepoId, oldKey)
    next[newKey] = {
      ...structuredClone(lineage),
      worktreeId: rekeyWorktreeId(oldRepoId, newRepoId, lineage.worktreeId),
      parentWorktreeId: rekeyWorktreeId(oldRepoId, newRepoId, lineage.parentWorktreeId)
    }
  }
  return next
}

export function rekeyWorkspaceLineageRecord(
  record: PersistedState['workspaceLineageByChildKey'],
  oldRepoId: string,
  newRepoId: string
): PersistedState['workspaceLineageByChildKey'] {
  const next: PersistedState['workspaceLineageByChildKey'] = {}
  for (const [oldKey, lineage] of Object.entries(record)) {
    const newChildKey = rekeyWorkspaceKey(oldRepoId, newRepoId, oldKey as WorkspaceKey)
    const newParentKey = rekeyWorkspaceKey(oldRepoId, newRepoId, lineage.parentWorkspaceKey)
    if (newChildKey === oldKey && newParentKey === lineage.parentWorkspaceKey) {
      continue
    }
    next[newChildKey] = {
      ...structuredClone(lineage),
      childWorkspaceKey: newChildKey,
      parentWorkspaceKey: newParentKey
    }
  }
  return next
}

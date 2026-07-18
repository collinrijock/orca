import type { WorkspaceSessionState } from '../../shared/types'
import { ownerKeyBelongsToRepo } from './profile-project-worktree-identity'
import type { TransferProfileState } from './profile-project-state-file'

export function collectProjectTerminalBindingIds(
  state: TransferProfileState,
  repoId: string
): Set<string> {
  const ids = new Set<string>()
  collectWorkspaceProjectBindings(state.workspaceSession, repoId, ids)
  for (const session of Object.values(state.workspaceSessionsByHostId ?? {})) {
    if (session) {
      collectWorkspaceProjectBindings(session, repoId, ids)
    }
  }
  return ids
}

export function collectProjectLocalTerminalBindingIds(
  state: TransferProfileState,
  repoId: string
): Set<string> {
  const ids = new Set<string>()
  collectWorkspaceProjectBindings(state.workspaceSession, repoId, ids)
  return ids
}

export function collectAllLocalTerminalBindingIds(state: TransferProfileState): Set<string> {
  const ids = new Set<string>()
  collectAllWorkspaceBindings(state.workspaceSession, ids)
  return ids
}

export function collectNonProjectTerminalBindingIds(
  state: TransferProfileState,
  repoId: string
): Set<string> {
  const all = new Set<string>()
  collectAllWorkspaceBindings(state.workspaceSession, all)
  for (const session of Object.values(state.workspaceSessionsByHostId ?? {})) {
    if (session) {
      collectAllWorkspaceBindings(session, all)
    }
  }
  for (const id of collectProjectTerminalBindingIds(state, repoId)) {
    all.delete(id)
  }
  return all
}

function collectWorkspaceProjectBindings(
  session: WorkspaceSessionState,
  repoId: string,
  ids: Set<string>
): void {
  const tabIds = new Set<string>()
  for (const [workspaceKey, tabs] of Object.entries(session.tabsByWorktree)) {
    if (!ownerKeyBelongsToRepo(workspaceKey, repoId)) {
      continue
    }
    for (const tab of tabs) {
      tabIds.add(tab.id)
      if (tab.ptyId) {
        ids.add(tab.ptyId)
      }
    }
  }
  for (const tabId of tabIds) {
    for (const ptyId of Object.values(
      session.terminalLayoutsByTabId[tabId]?.ptyIdsByLeafId ?? {}
    )) {
      ids.add(ptyId)
    }
  }
}

function collectAllWorkspaceBindings(session: WorkspaceSessionState, ids: Set<string>): void {
  for (const tabs of Object.values(session.tabsByWorktree)) {
    for (const tab of tabs) {
      if (tab.ptyId) {
        ids.add(tab.ptyId)
      }
    }
  }
  for (const layout of Object.values(session.terminalLayoutsByTabId)) {
    for (const ptyId of Object.values(layout.ptyIdsByLeafId ?? {})) {
      ids.add(ptyId)
    }
  }
}

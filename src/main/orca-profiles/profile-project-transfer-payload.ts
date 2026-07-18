import { randomUUID } from 'node:crypto'
import { getRepoExecutionHostId, type ExecutionHostId } from '../../shared/execution-host'
import { projectHostSetupProjectionFromRepos } from '../../shared/project-host-setup-projection'
import type { SshTarget } from '../../shared/ssh-types'
import type { PersistedState, Repo, SparsePreset } from '../../shared/types'
import type { DaemonSessionOwnershipState } from '../../shared/daemon-session-ownership'
import type { TransferProfileState } from './profile-project-state-file'
import { rebuildRepoBackedProjectState } from './profile-project-state-file'
import { mergeHostWorkspaceSessions, mergeWorkspaceSessions } from './profile-project-session-state'
import {
  extractHostSessionsForTransfer,
  extractSessionForTransfer
} from './profile-project-session-transfer'
import {
  mergeTransferredProjectOwnership,
  ownershipForTransferredProject,
  type ProjectTransferOwnershipIdentity
} from './profile-project-daemon-ownership-transfer'
import {
  collectTransferWorktreeIds,
  rekeyWorkspaceLineageRecord,
  rekeyWorktreeIdRecord,
  rekeyWorktreeLineageRecord
} from './profile-project-transfer-topology'
import {
  collectProjectLocalTerminalBindingIds,
  collectProjectTerminalBindingIds
} from './profile-project-terminal-binding-ids'

export type TransferPayload = {
  repo: Repo
  sparsePresets: SparsePreset[]
  worktreeMeta: PersistedState['worktreeMeta']
  worktreeLineageById: PersistedState['worktreeLineageById']
  workspaceLineageByChildKey: PersistedState['workspaceLineageByChildKey']
  workspaceSession?: PersistedState['workspaceSession']
  workspaceSessionsByHostId?: Partial<Record<ExecutionHostId, PersistedState['workspaceSession']>>
  sshTargets: SshTarget[]
  targetProjectId: string | null
  daemonSessionOwnership?: DaemonSessionOwnershipState
}

export function createTargetRepo(
  sourceRepo: Repo,
  targetState: TransferProfileState,
  copy: boolean,
  preferredTargetRepoId?: string
): Repo {
  const targetRepoId =
    preferredTargetRepoId ??
    (!copy && !targetState.repos.some((repo) => repo.id === sourceRepo.id)
      ? sourceRepo.id
      : createUniqueRepoId(targetState))
  if (targetState.repos.some((repo) => repo.id === targetRepoId)) {
    throw new Error('target_repo_id_conflict')
  }
  const repo: Repo = {
    ...sourceRepo,
    id: targetRepoId,
    projectGroupId: null,
    addedAt: copy ? Date.now() : sourceRepo.addedAt
  }
  delete repo.projectGroupOrder
  return repo
}

function createUniqueRepoId(state: TransferProfileState): string {
  const existingRepoIds = new Set(state.repos.map((repo) => repo.id))
  let candidate = randomUUID()
  while (existingRepoIds.has(candidate)) {
    candidate = randomUUID()
  }
  return candidate
}

export function createTransferPayload(args: {
  sourceState: TransferProfileState
  sourceRepo: Repo
  targetRepo: Repo
  includeSessions: boolean
  transfer?: ProjectTransferOwnershipIdentity
}): TransferPayload {
  const { sourceState, sourceRepo, targetRepo, includeSessions } = args
  const oldRepoId = sourceRepo.id
  const newRepoId = targetRepo.id
  const worktreeIds = collectTransferWorktreeIds(sourceState, oldRepoId)
  const targetProjection = projectHostSetupProjectionFromRepos([targetRepo])
  const targetProjectId =
    targetProjection.setups[0]?.projectId ?? targetProjection.projects[0]?.id ?? null
  const daemonSessionOwnership = includeSessions
    ? ownershipForTransferredProject({
        sourceState,
        oldRepoId,
        newRepoId,
        transfer: requireTransferIdentity(args.transfer),
        transferredBindingIds: collectProjectTerminalBindingIds(sourceState, oldRepoId),
        transferredLocalBindingIds: collectProjectLocalTerminalBindingIds(sourceState, oldRepoId)
      })
    : undefined
  return {
    repo: targetRepo,
    sparsePresets: (sourceState.sparsePresetsByRepo[oldRepoId] ?? []).map((preset) => ({
      ...structuredClone(preset),
      repoId: newRepoId
    })),
    worktreeMeta: rekeyWorktreeIdRecord(
      sourceState.worktreeMeta,
      worktreeIds,
      oldRepoId,
      newRepoId,
      (meta) => ({
        ...structuredClone(meta),
        ...(targetProjectId ? { projectId: targetProjectId } : {}),
        hostId: getRepoExecutionHostId(targetRepo),
        projectHostSetupId: targetRepo.id
      })
    ),
    worktreeLineageById: rekeyWorktreeLineageRecord(
      sourceState.worktreeLineageById,
      worktreeIds,
      oldRepoId,
      newRepoId
    ),
    workspaceLineageByChildKey: rekeyWorkspaceLineageRecord(
      sourceState.workspaceLineageByChildKey,
      oldRepoId,
      newRepoId
    ),
    ...(includeSessions
      ? {
          workspaceSession: extractSessionForTransfer(
            sourceState.workspaceSession,
            oldRepoId,
            newRepoId
          ),
          workspaceSessionsByHostId: extractHostSessionsForTransfer(
            sourceState.workspaceSessionsByHostId,
            oldRepoId,
            newRepoId
          )
        }
      : {}),
    sshTargets: sourceRepo.connectionId
      ? sourceState.sshTargets.filter((target) => target.id === sourceRepo.connectionId)
      : [],
    targetProjectId,
    ...(daemonSessionOwnership ? { daemonSessionOwnership } : {})
  }
}

function requireTransferIdentity(
  transfer: ProjectTransferOwnershipIdentity | undefined
): ProjectTransferOwnershipIdentity {
  if (!transfer) {
    throw new Error('missing_project_transfer_identity')
  }
  return transfer
}

export function applyPayloadToTarget(
  targetState: TransferProfileState,
  payload: TransferPayload
): TransferProfileState {
  const next: TransferProfileState = {
    ...targetState,
    repos: [...targetState.repos, payload.repo],
    sparsePresetsByRepo: {
      ...targetState.sparsePresetsByRepo,
      ...(payload.sparsePresets.length > 0 ? { [payload.repo.id]: payload.sparsePresets } : {})
    },
    worktreeMeta: { ...targetState.worktreeMeta, ...payload.worktreeMeta },
    worktreeLineageById: { ...targetState.worktreeLineageById, ...payload.worktreeLineageById },
    workspaceLineageByChildKey: {
      ...targetState.workspaceLineageByChildKey,
      ...payload.workspaceLineageByChildKey
    },
    sshTargets: mergeSshTargets(targetState.sshTargets, payload.sshTargets)
  }
  if (payload.workspaceSession) {
    next.workspaceSession = mergeWorkspaceSessions(
      targetState.workspaceSession,
      payload.workspaceSession
    )
  }
  if (payload.workspaceSessionsByHostId) {
    next.workspaceSessionsByHostId = mergeHostWorkspaceSessions(
      targetState.workspaceSessionsByHostId,
      payload.workspaceSessionsByHostId
    )
  }
  if (payload.daemonSessionOwnership) {
    next.daemonSessionOwnership = mergeTransferredProjectOwnership(
      targetState,
      payload.daemonSessionOwnership
    )
  }
  return rebuildRepoBackedProjectState(next)
}

function mergeSshTargets(existing: SshTarget[], incoming: SshTarget[]): SshTarget[] {
  const existingIds = new Set(existing.map((target) => target.id))
  return [...existing, ...incoming.filter((target) => !existingIds.has(target.id))]
}

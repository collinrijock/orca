import { randomUUID } from 'node:crypto'
import type {
  TransferOrcaProfileProjectArgs,
  TransferOrcaProfileProjectResult
} from '../../shared/orca-profiles'
import type { Repo } from '../../shared/types'
import { markOrcaProfileInitialized } from './profile-index-initialization'
import { getOrcaProfileListState } from './profile-index-store'
import { removeSourceRepo } from './profile-project-source-removal'
import { readProfileState, writeProfileState } from './profile-project-state-file'
import {
  applyPayloadToTarget,
  createTargetRepo,
  createTransferPayload
} from './profile-project-transfer-payload'
import {
  clearTargetTransferLineage,
  findSourcePendingTransfer,
  findTargetTransferLineage,
  markSourceTransferPending,
  transferIdentityFromPending
} from './profile-project-transfer-lineage'
import { repoPhysicalKey } from './profile-project-worktree-identity'
import type { ProjectTransferOwnershipIdentity } from './profile-project-daemon-ownership-transfer'

function assertKnownProfiles(args: TransferOrcaProfileProjectArgs, userDataPath: string): void {
  const profiles = getOrcaProfileListState(userDataPath).profiles
  const ids = new Set(profiles.map((profile) => profile.id))
  if (!ids.has(args.sourceProfileId)) {
    throw new Error('unknown_source_orca_profile')
  }
  if (!ids.has(args.targetProfileId)) {
    throw new Error('unknown_target_orca_profile')
  }
  if (args.sourceProfileId === args.targetProfileId) {
    throw new Error('matching_orca_profile_transfer')
  }
}

export function transferOrcaProfileProject(
  args: TransferOrcaProfileProjectArgs,
  userDataPath: string,
  options: { onSourcePendingCommitted?: () => void } = {}
): TransferOrcaProfileProjectResult {
  assertKnownProfiles(args, userDataPath)
  const sourceState = readProfileState(args.sourceProfileId, userDataPath)
  const targetState = readProfileState(args.targetProfileId, userDataPath)
  const sourceRepo = sourceState.repos.find((repo) => repo.id === args.repoId)
  if (!sourceRepo) {
    return resumeMoveWithoutSource(args, userDataPath, targetState)
  }

  const duplicate = targetState.repos.find(
    (repo) => repoPhysicalKey(repo) === repoPhysicalKey(sourceRepo)
  )
  if (args.mode === 'copy') {
    if (duplicate) {
      return duplicateResult(args, sourceRepo.id, duplicate.id)
    }
    return copyProject(args, userDataPath, sourceState, targetState, sourceRepo)
  }

  const request = transferRequest(args, sourceRepo.id)
  const pending = findSourcePendingTransfer(sourceState, request)
  const targetLineage = pending
    ? findTargetTransferLineage({
        state: targetState,
        request,
        operationId: pending.operationId
      })
    : null
  if (duplicate) {
    const lineageTargetRepoId = targetLineage?.targetRepoId ?? targetLineage?.repoId
    if (targetLineage && lineageTargetRepoId === duplicate.id) {
      const transfer = transferIdentityFromPending({
        pending: targetLineage,
        targetRepoId: duplicate.id
      })
      return completeMove(
        args,
        userDataPath,
        sourceState,
        targetState,
        sourceRepo,
        duplicate,
        transfer
      )
    }
    return duplicateResult(args, sourceRepo.id, duplicate.id)
  }

  const targetRepoId = pending?.targetRepoId ?? createTargetRepo(sourceRepo, targetState, false).id
  const targetRepo = createTargetRepo(sourceRepo, targetState, false, targetRepoId)
  const transfer: ProjectTransferOwnershipIdentity = pending
    ? transferIdentityFromPending({ pending, targetRepoId })
    : {
        operationId: randomUUID(),
        sourceProfileId: args.sourceProfileId,
        targetProfileId: args.targetProfileId,
        sourceRepoId: sourceRepo.id,
        targetRepoId,
        ...(sourceState.daemonSessionOwnership ? {} : { sourceOwnershipFormat: 'legacy' as const }),
        createdAt: Date.now()
      }
  const sourceForTransfer = markSourceTransferPending(sourceState, transfer)
  // Why: source-pending is durable before the target write, so every crash point
  // leaves at least one profile conservatively protecting the physical sessions.
  writeProfileState(args.sourceProfileId, userDataPath, sourceForTransfer)
  options.onSourcePendingCommitted?.()
  const payload = createTransferPayload({
    sourceState: sourceForTransfer,
    sourceRepo,
    targetRepo,
    includeSessions: true,
    transfer
  })
  const targetWithPayload = applyPayloadToTarget(targetState, payload)
  writeTargetTransferState(args.targetProfileId, userDataPath, targetWithPayload)
  return completeMove(
    args,
    userDataPath,
    sourceForTransfer,
    targetWithPayload,
    sourceRepo,
    targetRepo,
    transfer,
    payload.targetProjectId
  )
}

function copyProject(
  args: TransferOrcaProfileProjectArgs,
  userDataPath: string,
  sourceState: ReturnType<typeof readProfileState>,
  targetState: ReturnType<typeof readProfileState>,
  sourceRepo: Repo
): TransferOrcaProfileProjectResult {
  const targetRepo = createTargetRepo(sourceRepo, targetState, true)
  const payload = createTransferPayload({
    sourceState,
    sourceRepo,
    targetRepo,
    includeSessions: false
  })
  writeTargetTransferState(
    args.targetProfileId,
    userDataPath,
    applyPayloadToTarget(targetState, payload)
  )
  return transferredResult(args, sourceRepo.id, targetRepo.id, payload.targetProjectId)
}

function completeMove(
  args: TransferOrcaProfileProjectArgs,
  userDataPath: string,
  sourceState: ReturnType<typeof readProfileState>,
  targetState: ReturnType<typeof readProfileState>,
  sourceRepo: Repo,
  targetRepo: Repo,
  transfer: ProjectTransferOwnershipIdentity,
  targetProjectId = projectIdForRepo(targetState, targetRepo.id)
): TransferOrcaProfileProjectResult {
  writeProfileState(
    args.sourceProfileId,
    userDataPath,
    removeSourceRepo(sourceState, sourceRepo.id, transfer.operationId)
  )
  // Why: source deletion commits before removing the target receipt; a failed final
  // write remains resumable from target-lineage without creating an ownership gap.
  try {
    writeTargetTransferState(
      args.targetProfileId,
      userDataPath,
      clearTargetTransferLineage(targetState, transfer.operationId)
    )
  } catch (error) {
    // Why: source deletion is the commit point; the conservative target receipt
    // is safe to retain and startup retries only this cleanup write.
    console.warn(
      '[orca-profiles] Deferred completed project-transfer receipt cleanup:',
      error instanceof Error ? error.message : String(error)
    )
  }
  return transferredResult(args, sourceRepo.id, targetRepo.id, targetProjectId)
}

function resumeMoveWithoutSource(
  args: TransferOrcaProfileProjectArgs,
  userDataPath: string,
  targetState: ReturnType<typeof readProfileState>
): TransferOrcaProfileProjectResult {
  if (args.mode !== 'move') {
    throw new Error('unknown_source_repo')
  }
  const lineage = findTargetTransferLineage({
    state: targetState,
    request: transferRequest(args, args.repoId)
  })
  if (!lineage) {
    throw new Error('unknown_source_repo')
  }
  const targetRepoId = lineage.targetRepoId ?? lineage.repoId
  const targetRepo = targetState.repos.find((repo) => repo.id === targetRepoId)
  if (!targetRepo) {
    throw new Error('incomplete_project_transfer_target')
  }
  writeTargetTransferState(
    args.targetProfileId,
    userDataPath,
    clearTargetTransferLineage(targetState, lineage.operationId)
  )
  return transferredResult(
    args,
    args.repoId,
    targetRepo.id,
    projectIdForRepo(targetState, targetRepo.id)
  )
}

function writeTargetTransferState(
  profileId: string,
  userDataPath: string,
  state: ReturnType<typeof readProfileState>
): void {
  // Why: commit index authority before state so a crash can only make the
  // ownership snapshot conservative, never falsely complete-empty.
  markOrcaProfileInitialized(profileId, userDataPath)
  writeProfileState(profileId, userDataPath, state)
}

function transferRequest(args: TransferOrcaProfileProjectArgs, sourceRepoId: string) {
  return {
    sourceProfileId: args.sourceProfileId,
    targetProfileId: args.targetProfileId,
    sourceRepoId
  }
}

function projectIdForRepo(
  state: ReturnType<typeof readProfileState>,
  repoId: string
): string | null {
  return state.projectHostSetups.find((setup) => setup.repoId === repoId)?.projectId ?? null
}

function transferredResult(
  args: TransferOrcaProfileProjectArgs,
  sourceRepoId: string,
  targetRepoId: string,
  targetProjectId: string | null
): TransferOrcaProfileProjectResult {
  return {
    status: 'transferred',
    mode: args.mode,
    sourceProfileId: args.sourceProfileId,
    targetProfileId: args.targetProfileId,
    sourceRepoId,
    targetRepoId,
    targetProjectId
  }
}

function duplicateResult(
  args: TransferOrcaProfileProjectArgs,
  sourceRepoId: string,
  duplicateRepoId: string
): TransferOrcaProfileProjectResult {
  return {
    status: 'duplicate-target',
    sourceProfileId: args.sourceProfileId,
    targetProfileId: args.targetProfileId,
    sourceRepoId,
    duplicateRepoId
  }
}

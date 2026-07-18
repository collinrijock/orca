import {
  createEmptyDaemonSessionOwnershipState,
  type ProfileProjectTransferLineage
} from '../../shared/daemon-session-ownership'
import type { TransferProfileState } from './profile-project-state-file'
import {
  ownershipForLegacyPendingSource,
  type ProjectTransferOwnershipIdentity
} from './profile-project-daemon-ownership-transfer'

type TransferRequestIdentity = {
  sourceProfileId: string
  targetProfileId: string
  sourceRepoId: string
}

function matchesRequest(
  lineage: ProfileProjectTransferLineage,
  request: TransferRequestIdentity
): boolean {
  return (
    lineage.sourceProfileId === request.sourceProfileId &&
    lineage.targetProfileId === request.targetProfileId &&
    lineage.repoId === request.sourceRepoId
  )
}

export function findSourcePendingTransfer(
  state: TransferProfileState,
  request: TransferRequestIdentity
): ProfileProjectTransferLineage | null {
  const candidates = (state.daemonSessionOwnership?.projectTransferLineage ?? [])
    .filter((lineage) => lineage.role === 'source-pending' && matchesRequest(lineage, request))
    .sort(
      (left, right) =>
        left.createdAt - right.createdAt || left.operationId.localeCompare(right.operationId)
    )
  return candidates[0] ?? null
}

export function findTargetTransferLineage(args: {
  state: TransferProfileState
  request: TransferRequestIdentity
  operationId?: string
}): ProfileProjectTransferLineage | null {
  const candidates = (args.state.daemonSessionOwnership?.projectTransferLineage ?? []).filter(
    (lineage) =>
      lineage.role === 'target-lineage' &&
      matchesRequest(lineage, args.request) &&
      (args.operationId === undefined || lineage.operationId === args.operationId)
  )
  const operationIds = new Set(candidates.map((lineage) => lineage.operationId))
  const targetRepoIds = new Set(candidates.map((lineage) => lineage.targetRepoId ?? lineage.repoId))
  if (operationIds.size > 1 || targetRepoIds.size > 1) {
    throw new Error('ambiguous_project_transfer_lineage')
  }
  return candidates[0] ?? null
}

export function markSourceTransferPending(
  state: TransferProfileState,
  transfer: ProjectTransferOwnershipIdentity
): TransferProfileState {
  const ownership =
    state.daemonSessionOwnership ??
    (transfer.sourceOwnershipFormat === 'legacy'
      ? ownershipForLegacyPendingSource(state)
      : createEmptyDaemonSessionOwnershipState())
  const request: TransferRequestIdentity = {
    sourceProfileId: transfer.sourceProfileId,
    targetProfileId: transfer.targetProfileId,
    sourceRepoId: transfer.sourceRepoId
  }
  return {
    ...state,
    daemonSessionOwnership: {
      ...ownership,
      projectTransferLineage: [
        ...ownership.projectTransferLineage.filter(
          (lineage) => !(lineage.role === 'source-pending' && matchesRequest(lineage, request))
        ),
        {
          operationId: transfer.operationId,
          role: 'source-pending',
          sourceProfileId: transfer.sourceProfileId,
          targetProfileId: transfer.targetProfileId,
          repoId: transfer.sourceRepoId,
          targetRepoId: transfer.targetRepoId,
          ...(transfer.sourceOwnershipFormat
            ? { sourceOwnershipFormat: transfer.sourceOwnershipFormat }
            : {}),
          createdAt: transfer.createdAt
        }
      ]
    }
  }
}

export function clearTargetTransferLineage(
  state: TransferProfileState,
  operationId: string
): TransferProfileState {
  const ownership = state.daemonSessionOwnership
  if (!ownership) {
    return state
  }
  return {
    ...state,
    daemonSessionOwnership: {
      ...ownership,
      projectTransferLineage: ownership.projectTransferLineage.filter(
        (lineage) => lineage.operationId !== operationId
      )
    }
  }
}

export function transferIdentityFromPending(args: {
  pending: ProfileProjectTransferLineage
  targetRepoId: string
}): ProjectTransferOwnershipIdentity {
  return {
    operationId: args.pending.operationId,
    sourceProfileId: args.pending.sourceProfileId,
    targetProfileId: args.pending.targetProfileId,
    sourceRepoId: args.pending.repoId,
    targetRepoId: args.targetRepoId,
    ...(args.pending.sourceOwnershipFormat
      ? { sourceOwnershipFormat: args.pending.sourceOwnershipFormat }
      : {}),
    createdAt: args.pending.createdAt
  }
}

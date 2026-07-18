import {
  createEmptyDaemonSessionOwnershipState,
  type DaemonSessionClaim,
  type DaemonSessionOwnershipState
} from '../../shared/daemon-session-ownership'
import type { TransferProfileState } from './profile-project-state-file'
import { ownerKeyBelongsToRepo, rekeyOwnerKey } from './profile-project-worktree-identity'
import { classifyRawTerminalSessionId } from '../daemon/daemon-ownership-raw-remote-and-legacy'
import { parseAppSshPtyId } from '../../shared/ssh-pty-id'
import { collectAllLocalTerminalBindingIds } from './profile-project-terminal-binding-ids'

export type ProjectTransferOwnershipIdentity = {
  operationId: string
  sourceProfileId: string
  targetProfileId: string
  sourceRepoId: string
  targetRepoId: string
  sourceOwnershipFormat?: 'legacy'
  createdAt: number
}

function physicalClaimKey(
  claim: Pick<DaemonSessionClaim, 'protocolVersion' | 'sessionId'>
): string {
  return `${claim.protocolVersion}\0${claim.sessionId}`
}

export function ownershipForTransferredProject(args: {
  sourceState: TransferProfileState
  oldRepoId: string
  newRepoId: string
  transfer: ProjectTransferOwnershipIdentity
  transferredBindingIds: ReadonlySet<string>
  transferredLocalBindingIds: ReadonlySet<string>
}): DaemonSessionOwnershipState {
  const sourceOwnership = args.sourceState.daemonSessionOwnership
  const source = sourceOwnership ?? createEmptyDaemonSessionOwnershipState()
  const claims = source.claims
    .filter((claim) => ownerKeyBelongsToRepo(claim.workspaceKey, args.oldRepoId))
    .map((claim) => ({
      ...claim,
      workspaceKey:
        rekeyOwnerKey(args.oldRepoId, args.newRepoId, claim.workspaceKey) ?? claim.workspaceKey
    }))
  const sessionIds = new Set([
    ...args.transferredBindingIds,
    ...claims.map((claim) => claim.sessionId)
  ])
  const provenance = Object.fromEntries(
    [...sessionIds].flatMap((id) => {
      const existing = source.bindingProvenanceByPtyId[id]
      if (existing) {
        return [[id, existing] as const]
      }
      if (args.transfer.sourceOwnershipFormat !== 'legacy') {
        return []
      }
      const ssh = parseAppSshPtyId(id)
      if (!ssh && !args.transferredLocalBindingIds.has(id)) {
        return []
      }
      return [
        [
          id,
          ssh
            ? ({ kind: 'remote', providerId: ssh.connectionId } as const)
            : ({ kind: 'local-fallback' } as const)
        ] as const
      ]
    })
  )
  const legacyProtectedSessionIds = new Set(
    source.legacyProtectedSessionIds.filter((id) => sessionIds.has(id))
  )
  if (args.transfer.sourceOwnershipFormat === 'legacy') {
    for (const id of args.transferredLocalBindingIds) {
      if (classifyRawTerminalSessionId(id) === 'local') {
        legacyProtectedSessionIds.add(id)
      }
    }
  }
  return {
    schemaVersion: source.schemaVersion,
    claims,
    legacyProtectedSessionIds: [...legacyProtectedSessionIds],
    bindingProvenanceByPtyId: provenance,
    projectTransferLineage: [
      {
        operationId: args.transfer.operationId,
        role: 'target-lineage',
        sourceProfileId: args.transfer.sourceProfileId,
        targetProfileId: args.transfer.targetProfileId,
        repoId: args.transfer.sourceRepoId,
        targetRepoId: args.transfer.targetRepoId,
        ...(args.transfer.sourceOwnershipFormat
          ? { sourceOwnershipFormat: args.transfer.sourceOwnershipFormat }
          : {}),
        createdAt: args.transfer.createdAt
      }
    ]
  }
}

export function ownershipForLegacyPendingSource(
  state: TransferProfileState
): DaemonSessionOwnershipState {
  const ownership = createEmptyDaemonSessionOwnershipState()
  const protectedIds = new Set<string>()
  for (const id of collectAllLocalTerminalBindingIds(state)) {
    const ssh = parseAppSshPtyId(id)
    if (ssh) {
      ownership.bindingProvenanceByPtyId[id] = {
        kind: 'remote',
        providerId: ssh.connectionId
      }
    } else if (classifyRawTerminalSessionId(id) === 'local') {
      ownership.bindingProvenanceByPtyId[id] = { kind: 'local-fallback' }
      protectedIds.add(id)
    }
  }
  for (const id of state.claudeLivePtySessionIds ?? []) {
    if (classifyRawTerminalSessionId(id) === 'local') {
      protectedIds.add(id)
    }
  }
  for (const entry of state.migrationUnsupportedPtyEntries ?? []) {
    if (entry.source === 'local' && classifyRawTerminalSessionId(entry.ptyId) === 'local') {
      protectedIds.add(entry.ptyId)
    }
  }
  ownership.legacyProtectedSessionIds = [...protectedIds]
  return ownership
}

export function mergeTransferredProjectOwnership(
  targetState: TransferProfileState,
  transferred: DaemonSessionOwnershipState
): DaemonSessionOwnershipState {
  const target = targetState.daemonSessionOwnership ?? createEmptyDaemonSessionOwnershipState()
  const transferredClaimKeys = new Set(transferred.claims.map(physicalClaimKey))
  const retainedTargetClaims = target.claims.filter(
    (claim) => !transferredClaimKeys.has(physicalClaimKey(claim))
  )
  const retainedSessionIds = new Set(retainedTargetClaims.map((claim) => claim.sessionId))
  const provenance = { ...target.bindingProvenanceByPtyId }
  for (const [sessionId, transferredProvenance] of Object.entries(
    transferred.bindingProvenanceByPtyId
  )) {
    // Why: one session-id slot cannot represent two protocols. Preserve an unrelated
    // target protocol's provenance while retaining both exact claims conservatively.
    if (!retainedSessionIds.has(sessionId)) {
      provenance[sessionId] = transferredProvenance
    }
  }
  const transferredLineageKeys = new Set(
    transferred.projectTransferLineage.map((lineage) => `${lineage.role}\0${lineage.operationId}`)
  )
  return {
    schemaVersion: target.schemaVersion,
    claims: [...retainedTargetClaims, ...transferred.claims],
    legacyProtectedSessionIds: [
      ...new Set([...target.legacyProtectedSessionIds, ...transferred.legacyProtectedSessionIds])
    ],
    bindingProvenanceByPtyId: {
      ...provenance,
      ...Object.fromEntries(
        Object.entries(transferred.bindingProvenanceByPtyId).filter(
          ([sessionId]) => !retainedSessionIds.has(sessionId)
        )
      )
    },
    projectTransferLineage: [
      ...target.projectTransferLineage.filter(
        (lineage) => !transferredLineageKeys.has(`${lineage.role}\0${lineage.operationId}`)
      ),
      ...transferred.projectTransferLineage
    ]
  }
}

export function removeTransferredProjectOwnership(args: {
  state: TransferProfileState
  repoId: string
  transferOperationId?: string
  removedBindingIds: ReadonlySet<string>
  retainedBindingIds: ReadonlySet<string>
}): DaemonSessionOwnershipState | undefined {
  const ownership = args.state.daemonSessionOwnership
  if (!ownership) {
    return undefined
  }
  const transferLineage = ownership.projectTransferLineage.find(
    (entry) => entry.operationId === args.transferOperationId
  )
  if (transferLineage?.sourceOwnershipFormat === 'legacy') {
    // Why: source-pending temporarily needs a current-schema lineage receipt,
    // but a completed move must restore the source's legacy extraction contract.
    return undefined
  }
  const removedClaims = ownership.claims.filter((claim) =>
    ownerKeyBelongsToRepo(claim.workspaceKey, args.repoId)
  )
  const remainingClaims = ownership.claims.filter(
    (claim) => !ownerKeyBelongsToRepo(claim.workspaceKey, args.repoId)
  )
  const removedSessionIds = new Set([
    ...args.removedBindingIds,
    ...removedClaims.map((claim) => claim.sessionId)
  ])
  const retainedSessionIds = new Set(remainingClaims.map((claim) => claim.sessionId))
  return {
    ...ownership,
    claims: remainingClaims,
    legacyProtectedSessionIds: ownership.legacyProtectedSessionIds.filter(
      (id) =>
        !removedSessionIds.has(id) || retainedSessionIds.has(id) || args.retainedBindingIds.has(id)
    ),
    bindingProvenanceByPtyId: Object.fromEntries(
      Object.entries(ownership.bindingProvenanceByPtyId).filter(
        ([id]) =>
          !removedSessionIds.has(id) ||
          retainedSessionIds.has(id) ||
          args.retainedBindingIds.has(id)
      )
    ),
    projectTransferLineage: ownership.projectTransferLineage.filter(
      (entry) => entry.operationId !== args.transferOperationId
    )
  }
}

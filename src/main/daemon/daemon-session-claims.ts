import {
  DAEMON_SESSION_OWNERSHIP_SCHEMA_VERSION,
  type DaemonSessionClaim,
  type DaemonSessionClaimOwnerKind,
  type DaemonSessionOwnershipState,
  type ProfileProjectTransferLineage,
  type TerminalBindingProvenance
} from '../../shared/daemon-session-ownership'

const MAX_ID_LENGTH = 512

type OwnershipParseFailureReason = 'missing' | 'unsupported-schema' | 'malformed'

export type DaemonSessionOwnershipParseResult =
  | { ok: true; value: DaemonSessionOwnershipState }
  | { ok: false; reason: OwnershipParseFailureReason }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isBoundedId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH
}

function isProtocolVersion(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0
}

function isOwnerKind(value: unknown): value is DaemonSessionClaimOwnerKind {
  return (
    value === 'pane' ||
    value === 'sleep-route' ||
    value === 'runtime' ||
    value === 'retirement-pending'
  )
}

function parseClaim(value: unknown): DaemonSessionClaim | null {
  if (
    !isRecord(value) ||
    !isBoundedId(value.sessionId) ||
    !isOwnerKind(value.ownerKind) ||
    !isBoundedId(value.workspaceKey) ||
    !isBoundedId(value.ownerId) ||
    value.provider !== 'local-daemon' ||
    !isProtocolVersion(value.protocolVersion)
  ) {
    return null
  }
  return {
    sessionId: value.sessionId,
    ownerKind: value.ownerKind,
    workspaceKey: value.workspaceKey,
    ownerId: value.ownerId,
    provider: 'local-daemon',
    protocolVersion: value.protocolVersion
  }
}

function parseProvenance(value: unknown): TerminalBindingProvenance | null {
  if (!isRecord(value)) {
    return null
  }
  if (value.kind === 'local-daemon' && isProtocolVersion(value.protocolVersion)) {
    return { kind: 'local-daemon', protocolVersion: value.protocolVersion }
  }
  if (value.kind === 'local-fallback') {
    return { kind: 'local-fallback' }
  }
  if (value.kind === 'remote' && isBoundedId(value.providerId)) {
    return { kind: 'remote', providerId: value.providerId }
  }
  return null
}

function parseTransferLineage(value: unknown): ProfileProjectTransferLineage | null {
  if (
    !isRecord(value) ||
    !isBoundedId(value.operationId) ||
    (value.role !== 'source-pending' && value.role !== 'target-lineage') ||
    !isBoundedId(value.sourceProfileId) ||
    !isBoundedId(value.targetProfileId) ||
    !isBoundedId(value.repoId) ||
    (value.targetRepoId !== undefined && !isBoundedId(value.targetRepoId)) ||
    (value.sourceOwnershipFormat !== undefined && value.sourceOwnershipFormat !== 'legacy') ||
    typeof value.createdAt !== 'number' ||
    !Number.isFinite(value.createdAt) ||
    value.createdAt < 0
  ) {
    return null
  }
  return {
    operationId: value.operationId,
    role: value.role,
    sourceProfileId: value.sourceProfileId,
    targetProfileId: value.targetProfileId,
    repoId: value.repoId,
    ...(typeof value.targetRepoId === 'string' ? { targetRepoId: value.targetRepoId } : {}),
    ...(value.sourceOwnershipFormat === 'legacy'
      ? { sourceOwnershipFormat: 'legacy' as const }
      : {}),
    createdAt: value.createdAt
  }
}

export function parseDaemonSessionOwnershipState(
  value: unknown
): DaemonSessionOwnershipParseResult {
  if (value === undefined) {
    return { ok: false, reason: 'missing' }
  }
  if (!isRecord(value)) {
    return { ok: false, reason: 'malformed' }
  }
  if (value.schemaVersion !== DAEMON_SESSION_OWNERSHIP_SCHEMA_VERSION) {
    return { ok: false, reason: 'unsupported-schema' }
  }
  if (
    !Array.isArray(value.claims) ||
    !Array.isArray(value.legacyProtectedSessionIds) ||
    !isRecord(value.bindingProvenanceByPtyId) ||
    !Array.isArray(value.projectTransferLineage)
  ) {
    return { ok: false, reason: 'malformed' }
  }

  const claims = value.claims.map(parseClaim)
  const legacyProtectedSessionIds = value.legacyProtectedSessionIds
  const projectTransferLineage = value.projectTransferLineage.map(parseTransferLineage)
  if (
    claims.some((claim) => claim === null) ||
    legacyProtectedSessionIds.some((sessionId) => !isBoundedId(sessionId)) ||
    projectTransferLineage.some((row) => row === null)
  ) {
    return { ok: false, reason: 'malformed' }
  }

  const bindingProvenanceByPtyId: Record<string, TerminalBindingProvenance> = {}
  for (const [ptyId, rawProvenance] of Object.entries(value.bindingProvenanceByPtyId)) {
    const provenance = parseProvenance(rawProvenance)
    if (!isBoundedId(ptyId) || !provenance) {
      return { ok: false, reason: 'malformed' }
    }
    bindingProvenanceByPtyId[ptyId] = provenance
  }

  return {
    ok: true,
    value: {
      schemaVersion: DAEMON_SESSION_OWNERSHIP_SCHEMA_VERSION,
      claims: claims as DaemonSessionClaim[],
      legacyProtectedSessionIds: [...new Set(legacyProtectedSessionIds as string[])],
      bindingProvenanceByPtyId,
      projectTransferLineage: projectTransferLineage as ProfileProjectTransferLineage[]
    }
  }
}

export function daemonSessionClaimKey(claim: DaemonSessionClaim): string {
  return [
    claim.protocolVersion,
    claim.sessionId,
    claim.ownerKind,
    claim.workspaceKey,
    claim.ownerId
  ].join('\u0000')
}

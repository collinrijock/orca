import type {
  DaemonSessionClaim,
  DaemonSessionOwnershipState,
  TerminalBindingProvenance
} from '../../shared/daemon-session-ownership'
import { parseDaemonSessionOwnershipState } from './daemon-session-claims'
import {
  parseRawLocalWorkspace,
  type RawSleepingRoute,
  type RawTerminalBinding,
  type RawWorkspaceOwnership
} from './daemon-ownership-raw-workspace'
import {
  classifyRawTerminalSessionId,
  parseRawLegacyProtectionSurfaces,
  validateRawRemoteOwnershipSurfaces
} from './daemon-ownership-raw-remote-and-legacy'

const SUPPORTED_STATE_SCHEMA_VERSION = 1
const KNOWN_TOP_LEVEL_ID_FIELDS = new Set([
  'claudeLivePtySessionIds',
  'daemonSessionOwnership',
  'migrationUnsupportedPtyEntries',
  'sshRemotePtyLeases',
  'workspaceSession',
  'workspaceSessionsByHostId'
])

export type ExactDaemonSessionOwnership = { protocolVersion: number; sessionId: string }

export type ExtractedRawDaemonOwnership = {
  exactClaims: ExactDaemonSessionOwnership[]
  legacyProtectedSessionIds: string[]
}

export type RawDaemonOwnershipExtractionResult =
  | { status: 'complete'; ownership: ExtractedRawDaemonOwnership }
  | { status: 'incomplete'; reason: RawOwnershipFailureReason }

export type RawOwnershipFailureReason =
  | 'malformed-state'
  | 'unsupported-state-schema'
  | 'unsupported-ownership-field'
  | 'malformed-remote-partition'
  | 'malformed-legacy-protection'
  | 'malformed-current-ownership'
  | 'ownership-projection-mismatch'
  | 'unresolved-sleep-route'

export function extractRawDaemonOwnership(value: unknown): RawDaemonOwnershipExtractionResult {
  if (!isRecord(value)) {
    return incomplete('malformed-state')
  }
  if (value.schemaVersion !== SUPPORTED_STATE_SCHEMA_VERSION) {
    return incomplete('unsupported-state-schema')
  }
  if (hasUnknownTopLevelIdField(value)) {
    return incomplete('unsupported-ownership-field')
  }
  const workspace = parseRawLocalWorkspace(value.workspaceSession)
  if (!workspace.ok) {
    return incomplete(
      workspace.reason === 'unsupported-field'
        ? 'unsupported-ownership-field'
        : workspace.reason === 'malformed-workspace'
          ? 'malformed-state'
          : workspace.reason
    )
  }
  const remoteValidation = validateRawRemoteOwnershipSurfaces(value)
  if (remoteValidation !== 'valid') {
    return incomplete(remoteValidation)
  }
  const protections = parseRawLegacyProtectionSurfaces(value)
  if (protections === null) {
    return incomplete('malformed-legacy-protection')
  }

  const current = parseDaemonSessionOwnershipState(value.daemonSessionOwnership)
  if (!current.ok && current.reason !== 'missing') {
    return incomplete('malformed-current-ownership')
  }
  if (!current.ok) {
    const legacyBindings = collectLegacyBindings(workspace.value)
    if (legacyBindings === null) {
      return incomplete('unresolved-sleep-route')
    }
    for (const sessionId of legacyBindings) {
      protections.add(sessionId)
    }
    return complete([], protections)
  }

  const exactClaims = validateCurrentOwnership(current.value, workspace.value)
  if (exactClaims === null) {
    return incomplete('ownership-projection-mismatch')
  }
  for (const sessionId of current.value.legacyProtectedSessionIds) {
    if (classifyRawTerminalSessionId(sessionId) !== 'local') {
      return incomplete('malformed-current-ownership')
    }
    protections.add(sessionId)
  }
  return complete(exactClaims, protections)
}

function validateCurrentOwnership(
  ownership: DaemonSessionOwnershipState,
  workspace: RawWorkspaceOwnership
): ExactDaemonSessionOwnership[] | null {
  const claimByPhysicalId = new Map<string, DaemonSessionClaim>()
  for (const claim of ownership.claims) {
    if (classifyRawTerminalSessionId(claim.sessionId) !== 'local') {
      return null
    }
    const key = `${claim.protocolVersion}\0${claim.sessionId}`
    if (claimByPhysicalId.has(key)) {
      return null
    }
    claimByPhysicalId.set(key, claim)
  }

  const bindingById = new Map(workspace.bindings.map((binding) => [binding.sessionId, binding]))
  for (const binding of workspace.bindings) {
    const provenance = ownership.bindingProvenanceByPtyId[binding.sessionId]
    if (!provenance || !bindingMatchesProvenance(binding, provenance, claimByPhysicalId)) {
      return null
    }
  }
  for (const [sessionId, provenance] of Object.entries(ownership.bindingProvenanceByPtyId)) {
    if (!validateUnboundProvenance(sessionId, provenance, bindingById, claimByPhysicalId)) {
      return null
    }
  }
  for (const claim of ownership.claims) {
    if (
      !claimMatchesOwner(
        claim,
        bindingById,
        workspace.sleepingRoutes,
        ownership.bindingProvenanceByPtyId
      )
    ) {
      return null
    }
  }
  for (const route of workspace.sleepingRoutes) {
    if (
      !route.connectionId &&
      !routeHasClaim(route, ownership.claims) &&
      !routeHasLegacyProtection(route, ownership)
    ) {
      return null
    }
  }
  return ownership.claims.map(({ protocolVersion, sessionId }) => ({ protocolVersion, sessionId }))
}

function bindingMatchesProvenance(
  binding: RawTerminalBinding,
  provenance: TerminalBindingProvenance,
  claimByPhysicalId: ReadonlyMap<string, DaemonSessionClaim>
): boolean {
  const idClass = classifyRawTerminalSessionId(binding.sessionId)
  if (provenance.kind === 'remote') {
    return !hasClaimForSession(claimByPhysicalId, binding.sessionId)
  }
  if (idClass !== 'local') {
    return false
  }
  if (provenance.kind === 'local-fallback') {
    return !hasClaimForSession(claimByPhysicalId, binding.sessionId)
  }
  const claim = claimByPhysicalId.get(`${provenance.protocolVersion}\0${binding.sessionId}`)
  return Boolean(claim)
}

function validateUnboundProvenance(
  sessionId: string,
  provenance: TerminalBindingProvenance,
  bindingById: ReadonlyMap<string, RawTerminalBinding>,
  claimByPhysicalId: ReadonlyMap<string, DaemonSessionClaim>
): boolean {
  if (bindingById.has(sessionId)) {
    return true
  }
  if (provenance.kind !== 'local-daemon' || classifyRawTerminalSessionId(sessionId) !== 'local') {
    return false
  }
  const claim = claimByPhysicalId.get(`${provenance.protocolVersion}\0${sessionId}`)
  return Boolean(claim && claim.ownerKind !== 'pane')
}

function claimMatchesOwner(
  claim: DaemonSessionClaim,
  bindingById: ReadonlyMap<string, RawTerminalBinding>,
  sleepingRoutes: RawSleepingRoute[],
  provenanceBySessionId: Readonly<Record<string, TerminalBindingProvenance>>
): boolean {
  if (claim.ownerKind === 'runtime' || claim.ownerKind === 'retirement-pending') {
    return true
  }
  if (claim.ownerKind === 'sleep-route') {
    return sleepingRoutes.some(
      (route) =>
        !route.connectionId &&
        route.paneKey === claim.ownerId &&
        route.workspaceKey === claim.workspaceKey &&
        (!route.joinedSessionId ||
          (route.joinedSessionId === claim.sessionId &&
            provenanceMatchesClaim(provenanceBySessionId[claim.sessionId], claim)))
    )
  }
  const binding = bindingById.get(claim.sessionId)
  return Boolean(
    binding &&
    binding.workspaceKey === claim.workspaceKey &&
    (binding.leafId === null || binding.leafId === claim.ownerId) &&
    provenanceMatchesClaim(provenanceBySessionId[claim.sessionId], claim)
  )
}

function provenanceMatchesClaim(
  provenance: TerminalBindingProvenance | undefined,
  claim: DaemonSessionClaim
): boolean {
  return provenance?.kind === 'local-daemon' && provenance.protocolVersion === claim.protocolVersion
}

function routeHasClaim(route: RawSleepingRoute, claims: DaemonSessionClaim[]): boolean {
  return claims.some(
    (claim) =>
      claim.ownerKind === 'sleep-route' &&
      claim.ownerId === route.paneKey &&
      claim.workspaceKey === route.workspaceKey &&
      (!route.joinedSessionId || route.joinedSessionId === claim.sessionId)
  )
}

function routeHasLegacyProtection(
  route: RawSleepingRoute,
  ownership: DaemonSessionOwnershipState
): boolean {
  const sessionId = route.joinedSessionId
  return Boolean(
    sessionId &&
    ownership.bindingProvenanceByPtyId[sessionId]?.kind === 'local-fallback' &&
    ownership.legacyProtectedSessionIds.includes(sessionId)
  )
}

function collectLegacyBindings(workspace: RawWorkspaceOwnership): Set<string> | null {
  const ids = new Set<string>()
  for (const binding of workspace.bindings) {
    const classification = classifyRawTerminalSessionId(binding.sessionId)
    if (classification === 'invalid') {
      return null
    }
    if (classification === 'local') {
      ids.add(binding.sessionId)
    }
  }
  for (const route of workspace.sleepingRoutes) {
    if (route.connectionId) {
      continue
    }
    if (!route.joinedSessionId) {
      return null
    }
    const classification = classifyRawTerminalSessionId(route.joinedSessionId)
    if (classification === 'invalid') {
      return null
    }
    if (classification === 'local') {
      ids.add(route.joinedSessionId)
    }
  }
  return ids
}

function hasUnknownTopLevelIdField(value: Record<string, unknown>): boolean {
  return Object.keys(value).some(
    (key) =>
      /(?:pty|session).*(?:id|ids)|(?:id|ids).*(?:pty|session)/i.test(key) &&
      !KNOWN_TOP_LEVEL_ID_FIELDS.has(key)
  )
}

function hasClaimForSession(
  claims: ReadonlyMap<string, DaemonSessionClaim>,
  sessionId: string
): boolean {
  return [...claims.values()].some((claim) => claim.sessionId === sessionId)
}

function complete(
  exactClaims: ExactDaemonSessionOwnership[],
  protections: Set<string>
): RawDaemonOwnershipExtractionResult {
  return {
    status: 'complete',
    ownership: { exactClaims, legacyProtectedSessionIds: [...protections] }
  }
}

function incomplete(reason: RawOwnershipFailureReason): RawDaemonOwnershipExtractionResult {
  return { status: 'incomplete', reason }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

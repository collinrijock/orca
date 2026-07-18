export const DAEMON_SESSION_OWNERSHIP_SCHEMA_VERSION = 1

export type DaemonSessionClaimOwnerKind = 'pane' | 'sleep-route' | 'runtime' | 'retirement-pending'

export type DaemonSessionClaim = {
  sessionId: string
  ownerKind: DaemonSessionClaimOwnerKind
  workspaceKey: string
  ownerId: string
  provider: 'local-daemon'
  protocolVersion: number
}

export type TerminalBindingProvenance =
  | { kind: 'local-daemon'; protocolVersion: number }
  | { kind: 'local-fallback' }
  | { kind: 'remote'; providerId: string }

export type ProfileProjectTransferLineage = {
  operationId: string
  role: 'source-pending' | 'target-lineage'
  sourceProfileId: string
  targetProfileId: string
  /** Original source repo identity used to resume the same requested move. */
  repoId: string
  /** Chosen target identity stays stable when a crash happens before the target write. */
  targetRepoId?: string
  /** The source had no exact-ownership projection before this transfer began. */
  sourceOwnershipFormat?: 'legacy'
  createdAt: number
}

export type DaemonSessionOwnershipState = {
  schemaVersion: typeof DAEMON_SESSION_OWNERSHIP_SCHEMA_VERSION
  claims: DaemonSessionClaim[]
  /** Pre-provenance local bindings conservatively protected across protocols. */
  legacyProtectedSessionIds: string[]
  bindingProvenanceByPtyId: Record<string, TerminalBindingProvenance>
  projectTransferLineage: ProfileProjectTransferLineage[]
}

export function createEmptyDaemonSessionOwnershipState(): DaemonSessionOwnershipState {
  return {
    schemaVersion: DAEMON_SESSION_OWNERSHIP_SCHEMA_VERSION,
    claims: [],
    legacyProtectedSessionIds: [],
    bindingProvenanceByPtyId: {},
    projectTransferLineage: []
  }
}

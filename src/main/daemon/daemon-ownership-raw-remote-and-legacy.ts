import { parseExecutionHostId } from '../../shared/execution-host'
import { parseAppSshPtyId } from '../../shared/ssh-pty-id'
import { validateRawRemoteWorkspace } from './daemon-ownership-raw-workspace'

const MAX_ID_LENGTH = 512

export type RawRemoteOwnershipValidation =
  | 'valid'
  | 'malformed-remote-partition'
  | 'malformed-state'

export function validateRawRemoteOwnershipSurfaces(
  value: Record<string, unknown>
): RawRemoteOwnershipValidation {
  if (!validateRemotePartitions(value.workspaceSessionsByHostId)) {
    return 'malformed-remote-partition'
  }
  const leases = value.sshRemotePtyLeases
  if (leases !== undefined && (!Array.isArray(leases) || !leases.every(isValidRemoteLease))) {
    return 'malformed-state'
  }
  const tombstones = value.removedSshTargetTombstones
  if (tombstones !== undefined && (!Array.isArray(tombstones) || !tombstones.every(isRecord))) {
    return 'malformed-state'
  }
  return 'valid'
}

export function parseRawLegacyProtectionSurfaces(
  value: Record<string, unknown>
): Set<string> | null {
  const ids = new Set<string>()
  if (!appendIdArray(value.claudeLivePtySessionIds, ids)) {
    return null
  }
  const migration = value.migrationUnsupportedPtyEntries
  if (migration !== undefined) {
    if (!Array.isArray(migration)) {
      return null
    }
    for (const row of migration) {
      if (!isValidMigrationRow(row)) {
        return null
      }
      if (row.source === 'local') {
        ids.add(row.ptyId)
      }
    }
  }
  return validateAliasRows(value.legacyPaneKeyAliasEntries) ? ids : null
}

export function classifyRawTerminalSessionId(value: unknown): 'local' | 'remote' | 'invalid' {
  if (!isId(value)) {
    return 'invalid'
  }
  if (parseAppSshPtyId(value)) {
    return 'remote'
  }
  return value.startsWith('ssh:') ? 'invalid' : 'local'
}

function validateRemotePartitions(value: unknown): boolean {
  if (value === undefined) {
    return true
  }
  if (!isRecord(value)) {
    return false
  }
  return Object.entries(value).every(([hostId, workspace]) => {
    const parsed = parseExecutionHostId(hostId)
    return Boolean(parsed && parsed.kind !== 'local' && validateRawRemoteWorkspace(workspace))
  })
}

function appendIdArray(value: unknown, target: Set<string>): boolean {
  if (value === undefined) {
    return true
  }
  if (!Array.isArray(value)) {
    return false
  }
  for (const id of value) {
    const classification = classifyRawTerminalSessionId(id)
    if (classification === 'invalid') {
      return false
    }
    if (classification === 'local') {
      target.add(id as string)
    }
  }
  return true
}

function isValidRemoteLease(value: unknown): boolean {
  return (
    isRecord(value) &&
    isId(value.targetId) &&
    isId(value.ptyId) &&
    ['attached', 'detached', 'terminated', 'expired'].includes(String(value.state)) &&
    Number.isFinite(value.createdAt) &&
    Number.isFinite(value.updatedAt)
  )
}

function isValidMigrationRow(value: unknown): value is { ptyId: string; source: 'local' | 'ssh' } {
  return (
    isRecord(value) &&
    isId(value.ptyId) &&
    (value.source === 'local' || value.source === 'ssh') &&
    value.reason === 'legacy-numeric-pane-key' &&
    Number.isFinite(value.updatedAt) &&
    (value.source === 'ssh' || classifyRawTerminalSessionId(value.ptyId) === 'local')
  )
}

function validateAliasRows(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.every(
        (row) =>
          isRecord(row) &&
          isId(row.ptyId) &&
          isId(row.legacyPaneKey) &&
          isId(row.stablePaneKey) &&
          Number.isFinite(row.updatedAt)
      ))
  )
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

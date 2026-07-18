import { createHash } from 'node:crypto'

export const DAEMON_OWNERSHIP_COMMIT_SCHEMA_VERSION = 1

export type DaemonOwnershipCommit = {
  schemaVersion: typeof DAEMON_OWNERSHIP_COMMIT_SCHEMA_VERSION
  generation: number
  checksum: string
}

type OwnershipBearingState = object & {
  workspaceSession?: unknown
  workspaceSessionsByHostId?: unknown
  daemonSessionOwnership?: unknown
  daemonOwnershipCommit?: unknown
}

function committedProjection(state: OwnershipBearingState): Record<string, unknown> {
  const { daemonOwnershipCommit: _derivedCommit, ...committedState } = state as Record<
    string,
    unknown
  >
  return committedState
}

export function computeDaemonOwnershipChecksum(state: OwnershipBearingState): string {
  return createHash('sha256')
    .update(JSON.stringify(committedProjection(state)))
    .digest('hex')
}

export function withDaemonOwnershipCommit<T extends OwnershipBearingState>(
  state: T,
  generation: number
): T & { daemonOwnershipCommit: DaemonOwnershipCommit } {
  return {
    ...state,
    daemonOwnershipCommit: {
      schemaVersion: DAEMON_OWNERSHIP_COMMIT_SCHEMA_VERSION,
      generation,
      checksum: computeDaemonOwnershipChecksum(state)
    }
  }
}

export function parseValidDaemonOwnershipCommit(value: unknown): DaemonOwnershipCommit | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  const state = value as OwnershipBearingState
  const commit = state.daemonOwnershipCommit
  if (
    typeof commit !== 'object' ||
    commit === null ||
    (commit as { schemaVersion?: unknown }).schemaVersion !==
      DAEMON_OWNERSHIP_COMMIT_SCHEMA_VERSION ||
    !Number.isSafeInteger((commit as { generation?: unknown }).generation) ||
    (commit as { generation: number }).generation <= 0 ||
    typeof (commit as { checksum?: unknown }).checksum !== 'string' ||
    !/^[a-f0-9]{64}$/.test((commit as { checksum: string }).checksum) ||
    (commit as { checksum: string }).checksum !== computeDaemonOwnershipChecksum(state)
  ) {
    return null
  }
  return commit as DaemonOwnershipCommit
}

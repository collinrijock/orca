import { parseExecutionHostId } from './execution-host'

const SSH_PTY_ID_PREFIX = 'ssh:'
const SSH_PTY_ID_SEPARATOR = '@@'

// Why: reconnect/restore paths sometimes hand these routers the execution-host
// id form ("ssh:<targetId>", from a workspace `hostId`) instead of the bare SSH
// target id that app PTY ids embed. Both name the same connection, so collapse
// to the bare id before comparing/encoding — otherwise a valid reattach throws a
// spurious "belongs to SSH connection" error at the user.
function normalizeConnectionId(connectionId: string): string {
  const parsed = parseExecutionHostId(connectionId)
  return parsed?.kind === 'ssh' ? parsed.targetId : connectionId
}

// Why: SSH relays allocate target-local ids like "pty-1"; app-wide routing
// needs the target id embedded so two relays cannot collide after restore.
export type ParsedSshPtyId = {
  connectionId: string
  relayInstanceId?: string
  relayPtyId: string
}

export function parseAppSshPtyId(ptyId: string): ParsedSshPtyId | null {
  if (!ptyId.startsWith(SSH_PTY_ID_PREFIX)) {
    return null
  }
  const separatorIndex = ptyId.indexOf(SSH_PTY_ID_SEPARATOR, SSH_PTY_ID_PREFIX.length)
  if (separatorIndex === -1) {
    return null
  }
  const encodedConnectionId = ptyId.slice(SSH_PTY_ID_PREFIX.length, separatorIndex)
  const relayIdentity = ptyId.slice(separatorIndex + SSH_PTY_ID_SEPARATOR.length)
  const generationSeparatorIndex = relayIdentity.indexOf(SSH_PTY_ID_SEPARATOR)
  const encodedRelayInstanceId =
    generationSeparatorIndex === -1 ? null : relayIdentity.slice(0, generationSeparatorIndex)
  const relayPtyId =
    generationSeparatorIndex === -1
      ? relayIdentity
      : relayIdentity.slice(generationSeparatorIndex + SSH_PTY_ID_SEPARATOR.length)
  if (!encodedConnectionId || !relayPtyId) {
    return null
  }
  try {
    return {
      connectionId: decodeURIComponent(encodedConnectionId),
      ...(encodedRelayInstanceId
        ? { relayInstanceId: decodeURIComponent(encodedRelayInstanceId) }
        : {}),
      relayPtyId
    }
  } catch {
    return null
  }
}

export function toAppSshPtyId(
  connectionId: string,
  relayPtyId: string,
  relayInstanceId?: string
): string {
  const normalizedConnectionId = normalizeConnectionId(connectionId)
  const parsed = parseAppSshPtyId(relayPtyId)
  if (parsed) {
    if (parsed.connectionId !== normalizedConnectionId) {
      throw new Error(`PTY ${relayPtyId} belongs to SSH connection "${parsed.connectionId}"`)
    }
    if (!relayInstanceId || parsed.relayInstanceId === relayInstanceId) {
      return relayPtyId
    }
    relayPtyId = parsed.relayPtyId
  }
  const generationSegment = relayInstanceId
    ? `${encodeURIComponent(relayInstanceId)}${SSH_PTY_ID_SEPARATOR}`
    : ''
  return `${SSH_PTY_ID_PREFIX}${encodeURIComponent(normalizedConnectionId)}${SSH_PTY_ID_SEPARATOR}${generationSegment}${relayPtyId}`
}

export function toRelaySshPtyId(connectionId: string, ptyId: string): string {
  const parsed = parseAppSshPtyId(ptyId)
  if (!parsed) {
    return ptyId
  }
  if (parsed.connectionId !== normalizeConnectionId(connectionId)) {
    throw new Error(`PTY ${ptyId} belongs to SSH connection "${parsed.connectionId}"`)
  }
  return parsed.relayPtyId
}

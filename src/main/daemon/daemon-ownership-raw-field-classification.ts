const KNOWN_WORKSPACE_ID_FIELDS = new Set([
  'activeConnectionIdsAtShutdown',
  'defaultTerminalTabsAppliedByWorktreeId',
  'remoteSessionIdsByTabId',
  'sleepingAgentSessionsByPaneKey',
  'terminalLayoutsByTabId'
])
const KNOWN_NESTED_FIELDS = {
  tab: new Set(['id', 'ptyId']),
  layout: new Set(['ptyIdsByLeafId']),
  sleep: new Set(['providerSession']),
  none: new Set<string>()
} as const

export function hasUnknownWorkspaceOwnershipField(value: Record<string, unknown>): boolean {
  return Object.keys(value).some(
    (key) =>
      /(?:pty|session).*(?:id|ids)|(?:id|ids).*(?:pty|session)/i.test(key) &&
      !KNOWN_WORKSPACE_ID_FIELDS.has(key)
  )
}

export function hasUnknownNestedOwnershipField(
  value: Record<string, unknown>,
  kind: keyof typeof KNOWN_NESTED_FIELDS
): boolean {
  // Why: app schema v1 has gained additive fields before. Unknown nested ownership-like fields
  // must block absence instead of being silently skipped by an older raw extractor.
  return Object.keys(value).some(
    (key) => /pty|session/i.test(key) && !KNOWN_NESTED_FIELDS[kind].has(key)
  )
}

export function isRawOwnershipRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

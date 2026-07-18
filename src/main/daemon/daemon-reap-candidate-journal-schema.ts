export type DaemonReapCandidateFingerprint = {
  protocolVersion: number
  daemonPid: number
  daemonStartedAt: string
  sessionId: string
  sessionPid: number
  sessionStartedAt: string
}

export type DaemonReapCandidateObservation = {
  fingerprint: DaemonReapCandidateFingerprint
  disposition: 'unclaimed' | 'claimed' | 'protected' | 'dead' | 'unknown'
}

export type DaemonReapAuditedIncarnation = Pick<
  DaemonReapCandidateFingerprint,
  'protocolVersion' | 'daemonPid' | 'daemonStartedAt'
>

export type DaemonReapCandidateEntry = {
  fingerprint: DaemonReapCandidateFingerprint
  firstObservedAtMs: number
  lastObservedAtMs: number
  observedLaunchIds: string[]
}

export type DaemonReapJournalDocument =
  | { schemaVersion: 1; kind: 'active'; writtenAtMs: number; entries: DaemonReapCandidateEntry[] }
  | { schemaVersion: 1; kind: 'reset-required'; writtenAtMs: number }

export function parseDaemonReapJournal(
  contents: string
):
  | { status: 'ok'; document: DaemonReapJournalDocument }
  | { status: 'invalid'; reason: 'corrupt' | 'future-schema' } {
  let value: unknown
  try {
    value = JSON.parse(contents)
  } catch {
    return { status: 'invalid', reason: 'corrupt' }
  }
  if (isObject(value) && typeof value.schemaVersion === 'number' && value.schemaVersion > 1) {
    return { status: 'invalid', reason: 'future-schema' }
  }
  return validJournal(value)
    ? { status: 'ok', document: value }
    : { status: 'invalid', reason: 'corrupt' }
}

export function validDaemonReapObservation(value: DaemonReapCandidateObservation): boolean {
  return (
    isObject(value) &&
    exactKeys(value, ['fingerprint', 'disposition']) &&
    validFingerprint(value.fingerprint) &&
    ['unclaimed', 'claimed', 'protected', 'dead', 'unknown'].includes(value.disposition)
  )
}

export function validDaemonReapAuditedIncarnation(value: DaemonReapAuditedIncarnation): boolean {
  return (
    isObject(value) &&
    exactKeys(value, ['protocolVersion', 'daemonPid', 'daemonStartedAt']) &&
    validPositiveInteger(value.protocolVersion) &&
    validPid(value.daemonPid) &&
    validBoundedString(value.daemonStartedAt, 2_048)
  )
}

export function daemonReapAuditedIncarnationKey(value: DaemonReapAuditedIncarnation): string {
  return JSON.stringify([value.protocolVersion, value.daemonPid, value.daemonStartedAt])
}

export function daemonReapFingerprintKey(value: DaemonReapCandidateFingerprint): string {
  return JSON.stringify([
    value.protocolVersion,
    value.daemonPid,
    value.daemonStartedAt,
    value.sessionId,
    value.sessionPid,
    value.sessionStartedAt
  ])
}

export function compareDaemonReapEntries(
  a: DaemonReapCandidateEntry,
  b: DaemonReapCandidateEntry
): number {
  const aKey = daemonReapFingerprintKey(a.fingerprint)
  const bKey = daemonReapFingerprintKey(b.fingerprint)
  return aKey < bKey ? -1 : aKey > bKey ? 1 : 0
}

export function invalidateChangedDaemonReapIncarnations(
  entries: Map<string, DaemonReapCandidateEntry>,
  fingerprints: readonly DaemonReapCandidateFingerprint[]
): boolean {
  const daemonStarts = new Map<string, string>()
  const sessionFingerprints = new Map<string, string>()
  for (const fingerprint of fingerprints) {
    const daemonSlot = daemonSlotKey(fingerprint)
    const priorDaemonStart = daemonStarts.get(daemonSlot)
    if (priorDaemonStart && priorDaemonStart !== fingerprint.daemonStartedAt) {
      return false
    }
    daemonStarts.set(daemonSlot, fingerprint.daemonStartedAt)
    const sessionSlot = logicalSessionKey(fingerprint)
    const exact = daemonReapFingerprintKey(fingerprint)
    const priorSessionFingerprint = sessionFingerprints.get(sessionSlot)
    if (priorSessionFingerprint && priorSessionFingerprint !== exact) {
      return false
    }
    sessionFingerprints.set(sessionSlot, exact)
  }

  for (const [key, entry] of entries) {
    const current = entry.fingerprint
    const observedDaemonStart = daemonStarts.get(daemonSlotKey(current))
    const daemonReused =
      observedDaemonStart !== undefined && observedDaemonStart !== current.daemonStartedAt
    const observedSession = sessionFingerprints.get(logicalSessionKey(current))
    const sessionReused =
      observedSession !== undefined && observedSession !== daemonReapFingerprintKey(current)
    if (daemonReused || sessionReused) {
      entries.delete(key)
    }
  }
  return true
}

function validJournal(value: unknown): value is DaemonReapJournalDocument {
  if (!isObject(value) || value.schemaVersion !== 1 || !validTimestamp(value.writtenAtMs)) {
    return false
  }
  if (value.kind === 'reset-required') {
    return exactKeys(value, ['schemaVersion', 'kind', 'writtenAtMs'])
  }
  if (
    value.kind !== 'active' ||
    !exactKeys(value, ['schemaVersion', 'kind', 'writtenAtMs', 'entries']) ||
    !Array.isArray(value.entries)
  ) {
    return false
  }
  const exactFingerprints = new Set<string>()
  const logicalSessions = new Set<string>()
  for (const entry of value.entries) {
    if (!validEntry(entry) || entry.lastObservedAtMs > value.writtenAtMs) {
      return false
    }
    const exact = daemonReapFingerprintKey(entry.fingerprint)
    const logical = logicalSessionKey(entry.fingerprint)
    if (exactFingerprints.has(exact) || logicalSessions.has(logical)) {
      return false
    }
    exactFingerprints.add(exact)
    logicalSessions.add(logical)
  }
  return true
}

function validEntry(value: unknown): value is DaemonReapCandidateEntry {
  return (
    isObject(value) &&
    exactKeys(value, [
      'fingerprint',
      'firstObservedAtMs',
      'lastObservedAtMs',
      'observedLaunchIds'
    ]) &&
    validFingerprint(value.fingerprint) &&
    validTimestamp(value.firstObservedAtMs) &&
    validTimestamp(value.lastObservedAtMs) &&
    value.firstObservedAtMs <= value.lastObservedAtMs &&
    Array.isArray(value.observedLaunchIds) &&
    value.observedLaunchIds.length >= 1 &&
    value.observedLaunchIds.length <= 2 &&
    new Set(value.observedLaunchIds).size === value.observedLaunchIds.length &&
    value.observedLaunchIds.every((id) => validBoundedString(id, 128))
  )
}

function validFingerprint(value: unknown): value is DaemonReapCandidateFingerprint {
  return (
    isObject(value) &&
    exactKeys(value, [
      'protocolVersion',
      'daemonPid',
      'daemonStartedAt',
      'sessionId',
      'sessionPid',
      'sessionStartedAt'
    ]) &&
    validPositiveInteger(value.protocolVersion) &&
    validPid(value.daemonPid) &&
    validBoundedString(value.daemonStartedAt, 2_048) &&
    validBoundedString(value.sessionId, 2_048) &&
    validPid(value.sessionPid) &&
    validBoundedString(value.sessionStartedAt, 2_048)
  )
}

function logicalSessionKey(value: DaemonReapCandidateFingerprint): string {
  return JSON.stringify([
    value.protocolVersion,
    value.daemonPid,
    value.daemonStartedAt,
    value.sessionId
  ])
}

function daemonSlotKey(value: DaemonReapCandidateFingerprint): string {
  return JSON.stringify([value.protocolVersion, value.daemonPid])
}

function exactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return (
    actual.length === sortedExpected.length && sortedExpected.every((key, i) => key === actual[i])
  )
}

function validTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function validPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0
}

function validPid(value: unknown): value is number {
  return validPositiveInteger(value) && value <= 0xffff_ffff
}

function validBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

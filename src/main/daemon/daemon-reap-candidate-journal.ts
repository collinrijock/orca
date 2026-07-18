import {
  createDaemonReapJournalFilePersistence,
  type DaemonReapJournalPersistence
} from './daemon-reap-candidate-journal-file'
import {
  compareDaemonReapEntries,
  daemonReapAuditedIncarnationKey,
  daemonReapFingerprintKey,
  invalidateChangedDaemonReapIncarnations,
  parseDaemonReapJournal,
  validDaemonReapAuditedIncarnation,
  validDaemonReapObservation,
  type DaemonReapAuditedIncarnation,
  type DaemonReapCandidateEntry,
  type DaemonReapCandidateFingerprint,
  type DaemonReapCandidateObservation,
  type DaemonReapJournalDocument
} from './daemon-reap-candidate-journal-schema'

export type {
  DaemonReapAuditedIncarnation,
  DaemonReapCandidateFingerprint,
  DaemonReapCandidateObservation
} from './daemon-reap-candidate-journal-schema'

export const DAEMON_REAP_JOURNAL_SCHEMA_VERSION = 1
export const DAEMON_REAP_JOURNAL_FILE_NAME = 'daemon-reap-candidates.json'
export const DAEMON_REAP_JOURNAL_MAX_ENTRIES = 4_096
export const DAEMON_REAP_JOURNAL_MAX_BYTES = 4 * 1024 * 1024
export const DAEMON_REAP_MINIMUM_GRACE_MS = 7 * 24 * 60 * 60 * 1000
export const DAEMON_REAP_MAX_TRUSTED_CLOCK_ADVANCE_MS = 90 * 24 * 60 * 60 * 1000

// Why: journal maturity is evidence only. No environment/configuration value
// can turn the first production slice into signal or shutdown authority.
export const DAEMON_REAP_PRODUCTION_CAPABILITY = Object.freeze({
  mode: 'audit-only',
  enforcementEnabled: false
} as const)

export type DaemonReapJournalResult = {
  status: 'recorded' | 'incomplete'
  reason:
    | 'none'
    | 'missing'
    | 'corrupt'
    | 'future-schema'
    | 'oversized'
    | 'permission-invalid'
    | 'not-regular'
    | 'clock-invalid'
    | 'previous-reset'
    | 'overflow'
    | 'persistence-error'
    | 'secure-storage-unavailable'
    | 'invalid-input'
    | 'audit-incomplete'
  restartedObservation: boolean
  entryCount: number
  effectiveGraceMs: number
  matureCandidates: DaemonReapCandidateFingerprint[]
  enforcementAuthorized: false
  resetRequired?: true
}

export type DaemonReapCandidateJournalOptions = {
  runtimeDir: string
  now?: () => number
  configuredGraceMs?: number
  /** Tests inject persistence failures without changing production policy. */
  testPersistence?: DaemonReapJournalPersistence
  /** Tests exercise exact boundaries at small sizes; production never overrides these. */
  testLimits?: { maxEntries: number; maxBytes: number }
  /** Tests can force the production Windows fail-closed branch on any host. */
  testForceSecureStorageUnavailable?: boolean
}

export class DaemonReapCandidateJournal {
  private readonly now: () => number
  private readonly effectiveGraceMs: number
  private readonly persistence: DaemonReapJournalPersistence
  private readonly maxEntries: number
  private readonly maxBytes: number
  private readonly secureStorageAvailable: boolean

  constructor(options: DaemonReapCandidateJournalOptions) {
    this.now = options.now ?? Date.now
    this.effectiveGraceMs = Math.max(
      DAEMON_REAP_MINIMUM_GRACE_MS,
      validDuration(options.configuredGraceMs) ?? DAEMON_REAP_MINIMUM_GRACE_MS
    )
    this.persistence =
      options.testPersistence ??
      createDaemonReapJournalFilePersistence(options.runtimeDir, DAEMON_REAP_JOURNAL_FILE_NAME)
    this.maxEntries = boundedTestLimit(
      options.testLimits?.maxEntries,
      DAEMON_REAP_JOURNAL_MAX_ENTRIES
    )
    this.maxBytes = boundedTestLimit(options.testLimits?.maxBytes, DAEMON_REAP_JOURNAL_MAX_BYTES)
    // Why: candidate documents contain session IDs. POSIX modes are not a Windows DACL contract.
    this.secureStorageAvailable =
      process.platform !== 'win32' && options.testForceSecureStorageUnavailable !== true
  }

  incompleteAudit(): DaemonReapJournalResult {
    return this.result('incomplete', 'audit-incomplete', false, 0, [])
  }

  async observeCompleteLaunch(input: {
    launchId: string
    observations: readonly DaemonReapCandidateObservation[]
    completeDaemonIncarnations?: readonly DaemonReapAuditedIncarnation[]
  }): Promise<DaemonReapJournalResult> {
    if (!this.secureStorageAvailable) {
      return this.result('incomplete', 'secure-storage-unavailable', true, 0, [])
    }
    const nowMs = this.now()
    if (!validTimestamp(nowMs) || !validBoundedString(input.launchId, 128)) {
      return this.result('incomplete', 'invalid-input', true, 0, [])
    }
    const observationKeys = new Set<string>()
    const completeDaemonKeys = new Set<string>()
    if (
      input.observations.some((value) => {
        if (!validDaemonReapObservation(value)) {
          return true
        }
        const key = daemonReapFingerprintKey(value.fingerprint)
        if (observationKeys.has(key)) {
          return true
        }
        observationKeys.add(key)
        return false
      })
    ) {
      return this.result('incomplete', 'invalid-input', true, 0, [])
    }
    for (const incarnation of input.completeDaemonIncarnations ?? []) {
      if (!validDaemonReapAuditedIncarnation(incarnation)) {
        return this.result('incomplete', 'invalid-input', true, 0, [])
      }
      const key = daemonReapAuditedIncarnationKey(incarnation)
      if (completeDaemonKeys.has(key)) {
        return this.result('incomplete', 'invalid-input', true, 0, [])
      }
      completeDaemonKeys.add(key)
    }

    const loaded = await this.load(nowMs)
    const entries = new Map<string, DaemonReapCandidateEntry>()
    if (loaded.document?.kind === 'active') {
      for (const entry of loaded.document.entries) {
        entries.set(daemonReapFingerprintKey(entry.fingerprint), entry)
      }
    }
    if (
      !invalidateChangedDaemonReapIncarnations(
        entries,
        input.observations.map((value) => value.fingerprint)
      )
    ) {
      return this.result('incomplete', 'invalid-input', true, 0, [])
    }
    for (const [key, entry] of entries) {
      if (
        completeDaemonKeys.has(daemonReapAuditedIncarnationKey(entry.fingerprint)) &&
        !observationKeys.has(key)
      ) {
        entries.delete(key)
      }
    }

    const observedUnclaimed = new Set<string>()
    for (const observation of input.observations) {
      const key = daemonReapFingerprintKey(observation.fingerprint)
      if (observation.disposition !== 'unclaimed') {
        if (observation.disposition !== 'unknown') {
          entries.delete(key)
        }
        continue
      }
      observedUnclaimed.add(key)
      const existing = entries.get(key)
      entries.set(
        key,
        existing
          ? updateEntry(existing, input.launchId, nowMs)
          : firstEntry(observation.fingerprint, input.launchId, nowMs)
      )
    }

    const document: Extract<DaemonReapJournalDocument, { kind: 'active' }> = {
      schemaVersion: DAEMON_REAP_JOURNAL_SCHEMA_VERSION,
      kind: 'active',
      writtenAtMs: nowMs,
      entries: [...entries.values()].sort(compareDaemonReapEntries)
    }
    const encoded = JSON.stringify(document)
    if (
      document.entries.length > this.maxEntries ||
      Buffer.byteLength(encoded, 'utf8') > this.maxBytes
    ) {
      return this.commitResetMarker(nowMs)
    }
    if (!(await this.persistence.replaceAndReadBack(encoded, this.maxBytes))) {
      return this.result('incomplete', 'persistence-error', true, 0, [])
    }

    const mature = document.entries
      .filter(
        (entry) =>
          observedUnclaimed.has(daemonReapFingerprintKey(entry.fingerprint)) &&
          entry.observedLaunchIds.length >= 2 &&
          nowMs - entry.firstObservedAtMs >= this.effectiveGraceMs
      )
      .map((entry) => entry.fingerprint)
    return this.result('recorded', loaded.reason, loaded.restarted, document.entries.length, mature)
  }

  private async load(nowMs: number): Promise<{
    document: DaemonReapJournalDocument | null
    reason: DaemonReapJournalResult['reason']
    restarted: boolean
  }> {
    const read = await this.persistence.read(this.maxBytes)
    if (read.status === 'missing') {
      return { document: null, reason: 'missing', restarted: true }
    }
    if (read.status === 'invalid') {
      return { document: null, reason: read.reason, restarted: true }
    }
    const parsed = parseDaemonReapJournal(read.contents)
    if (parsed.status !== 'ok') {
      return { document: null, reason: parsed.reason, restarted: true }
    }
    if (parsed.document.kind === 'active' && parsed.document.entries.length > this.maxEntries) {
      return { document: null, reason: 'oversized', restarted: true }
    }
    if (
      nowMs < parsed.document.writtenAtMs ||
      nowMs - parsed.document.writtenAtMs > DAEMON_REAP_MAX_TRUSTED_CLOCK_ADVANCE_MS
    ) {
      return { document: null, reason: 'clock-invalid', restarted: true }
    }
    if (parsed.document.kind === 'reset-required') {
      return { document: null, reason: 'previous-reset', restarted: true }
    }
    return { document: parsed.document, reason: 'none', restarted: false }
  }

  private async commitResetMarker(nowMs: number): Promise<DaemonReapJournalResult> {
    const marker: DaemonReapJournalDocument = {
      schemaVersion: DAEMON_REAP_JOURNAL_SCHEMA_VERSION,
      kind: 'reset-required',
      writtenAtMs: nowMs
    }
    const committed = await this.persistence.replaceAndReadBack(
      JSON.stringify(marker),
      this.maxBytes
    )
    if (committed) {
      return { ...this.result('incomplete', 'overflow', true, 0, []), resetRequired: true }
    }
    // Why: if replacement failed, the old mature journal must not regain authority next launch.
    await this.persistence.invalidate(this.maxBytes)
    return this.result('incomplete', 'persistence-error', true, 0, [])
  }

  private result(
    status: DaemonReapJournalResult['status'],
    reason: DaemonReapJournalResult['reason'],
    restartedObservation: boolean,
    entryCount: number,
    matureCandidates: DaemonReapCandidateFingerprint[]
  ): DaemonReapJournalResult {
    return {
      status,
      reason,
      restartedObservation,
      entryCount,
      effectiveGraceMs: this.effectiveGraceMs,
      matureCandidates,
      enforcementAuthorized: false
    }
  }
}

function firstEntry(
  fingerprint: DaemonReapCandidateFingerprint,
  launchId: string,
  nowMs: number
): DaemonReapCandidateEntry {
  return {
    fingerprint,
    firstObservedAtMs: nowMs,
    lastObservedAtMs: nowMs,
    observedLaunchIds: [launchId]
  }
}

function updateEntry(
  entry: DaemonReapCandidateEntry,
  launchId: string,
  nowMs: number
): DaemonReapCandidateEntry {
  const observedLaunchIds = entry.observedLaunchIds.includes(launchId)
    ? entry.observedLaunchIds
    : [...entry.observedLaunchIds, launchId].slice(-2)
  return { ...entry, lastObservedAtMs: nowMs, observedLaunchIds }
}

function validTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function validBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
}

function validDuration(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : null
}

function boundedTestLimit(value: unknown, compiledLimit: number): number {
  return Number.isSafeInteger(value) && (value as number) >= 0
    ? Math.min(value as number, compiledLimit)
    : compiledLimit
}

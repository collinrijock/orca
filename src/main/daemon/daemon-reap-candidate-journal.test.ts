import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DAEMON_REAP_MINIMUM_GRACE_MS,
  DAEMON_REAP_PRODUCTION_CAPABILITY,
  DaemonReapCandidateJournal,
  type DaemonReapCandidateFingerprint,
  type DaemonReapCandidateObservation
} from './daemon-reap-candidate-journal'

function fingerprint(overrides: Partial<DaemonReapCandidateFingerprint> = {}) {
  return {
    protocolVersion: 22,
    daemonPid: 100,
    daemonStartedAt: 'daemon-start-a',
    sessionId: 'session-a',
    sessionPid: 200,
    sessionStartedAt: 'session-start-a',
    ...overrides
  }
}

function observation(
  value = fingerprint(),
  disposition: DaemonReapCandidateObservation['disposition'] = 'unclaimed'
): DaemonReapCandidateObservation {
  return { fingerprint: value, disposition }
}

describe('DaemonReapCandidateJournal observations', () => {
  let dir: string
  let nowMs: number

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'daemon-reap-journal-'))
    nowMs = 1_700_000_000_000
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function journal(configuredGraceMs?: number): DaemonReapCandidateJournal {
    return new DaemonReapCandidateJournal({
      runtimeDir: dir,
      now: () => nowMs,
      ...(configuredGraceMs === undefined ? {} : { configuredGraceMs })
    })
  }

  it('requires two distinct launches and the exact seven-day boundary', async () => {
    const store = journal()
    const first = await store.observeCompleteLaunch({
      launchId: 'launch-1',
      observations: [observation()]
    })
    expect(first).toMatchObject({ reason: 'missing', matureCandidates: [] })

    nowMs += DAEMON_REAP_MINIMUM_GRACE_MS - 1
    const early = await store.observeCompleteLaunch({
      launchId: 'launch-2',
      observations: [observation()]
    })
    expect(early.matureCandidates).toEqual([])

    nowMs += 1
    const mature = await store.observeCompleteLaunch({
      launchId: 'launch-3',
      observations: [observation()]
    })
    expect(mature.matureCandidates).toEqual([fingerprint()])
    expect(mature.enforcementAuthorized).toBe(false)
  })

  it('does not count repeated audits from the same launch twice', async () => {
    const store = journal()
    await store.observeCompleteLaunch({ launchId: 'same', observations: [observation()] })
    nowMs += DAEMON_REAP_MINIMUM_GRACE_MS

    const result = await store.observeCompleteLaunch({
      launchId: 'same',
      observations: [observation()]
    })

    expect(result.matureCandidates).toEqual([])
  })

  it('allows configuration to lengthen but never shorten the compiled grace', async () => {
    expect(journal(1).incompleteAudit().effectiveGraceMs).toBe(DAEMON_REAP_MINIMUM_GRACE_MS)
    const lengthened = journal(DAEMON_REAP_MINIMUM_GRACE_MS * 2)
    expect(lengthened.incompleteAudit().effectiveGraceMs).toBe(DAEMON_REAP_MINIMUM_GRACE_MS * 2)
  })

  it.each(['claimed', 'protected', 'dead'] as const)(
    'removes an observed %s candidate and restarts it if later unclaimed',
    async (disposition) => {
      const store = journal()
      await store.observeCompleteLaunch({ launchId: 'launch-1', observations: [observation()] })
      nowMs += DAEMON_REAP_MINIMUM_GRACE_MS
      const removed = await store.observeCompleteLaunch({
        launchId: 'launch-2',
        observations: [observation(fingerprint(), disposition)]
      })
      expect(removed).toMatchObject({ entryCount: 0, matureCandidates: [] })

      const restarted = await store.observeCompleteLaunch({
        launchId: 'launch-3',
        observations: [observation()]
      })
      expect(restarted).toMatchObject({ entryCount: 1, matureCandidates: [] })
    }
  )

  it('garbage-collects a disappeared identity only for a completely enumerated daemon', async () => {
    const store = journal()
    const disappeared = fingerprint({ sessionId: 'gone', sessionPid: 201 })
    await store.observeCompleteLaunch({
      launchId: 'launch-1',
      observations: [observation(), observation(disappeared)]
    })

    const result = await store.observeCompleteLaunch({
      launchId: 'launch-2',
      observations: [observation()],
      completeDaemonIncarnations: [
        { protocolVersion: 22, daemonPid: 100, daemonStartedAt: 'daemon-start-a' }
      ]
    })

    expect(result).toMatchObject({ status: 'recorded', entryCount: 1 })
  })

  it('suspends unknown and incomplete observations without granting maturity', async () => {
    const store = journal()
    await store.observeCompleteLaunch({ launchId: 'launch-1', observations: [observation()] })
    nowMs += DAEMON_REAP_MINIMUM_GRACE_MS

    const unknown = await store.observeCompleteLaunch({
      launchId: 'launch-2',
      observations: [observation(fingerprint(), 'unknown')]
    })
    expect(unknown).toMatchObject({ entryCount: 1, matureCandidates: [] })
    expect(store.incompleteAudit()).toMatchObject({
      status: 'incomplete',
      reason: 'audit-incomplete',
      enforcementAuthorized: false
    })
  })

  it('restarts on session PID/start-token reuse under the same session ID', async () => {
    const store = journal()
    await store.observeCompleteLaunch({ launchId: 'launch-1', observations: [observation()] })
    nowMs += DAEMON_REAP_MINIMUM_GRACE_MS
    const replacement = fingerprint({ sessionPid: 201, sessionStartedAt: 'session-start-b' })

    const result = await store.observeCompleteLaunch({
      launchId: 'launch-2',
      observations: [observation(replacement)]
    })

    expect(result).toMatchObject({ entryCount: 1, matureCandidates: [] })
  })

  it('invalidates every candidate when a numeric daemon PID is reused', async () => {
    const store = journal()
    const second = fingerprint({ sessionId: 'session-b', sessionPid: 201 })
    await store.observeCompleteLaunch({
      launchId: 'launch-1',
      observations: [observation(), observation(second)]
    })
    const replacement = fingerprint({ daemonStartedAt: 'daemon-start-b', sessionId: 'session-c' })

    const result = await store.observeCompleteLaunch({
      launchId: 'launch-2',
      observations: [observation(replacement)]
    })

    expect(result).toMatchObject({ entryCount: 1, matureCandidates: [] })
  })

  it.each([
    ['invalid PID', observation(fingerprint({ sessionPid: 0 }))],
    ['extra observation field', { ...observation(), extra: true }]
  ])('rejects %s input without creating a journal', async (_label, invalid) => {
    const result = await journal().observeCompleteLaunch({
      launchId: 'launch',
      observations: [invalid as DaemonReapCandidateObservation]
    })

    expect(result).toMatchObject({
      status: 'incomplete',
      reason: 'invalid-input',
      enforcementAuthorized: false
    })
  })

  it('rejects duplicate outcomes for one exact fingerprint', async () => {
    const result = await journal().observeCompleteLaunch({
      launchId: 'launch',
      observations: [observation(), observation(fingerprint(), 'claimed')]
    })

    expect(result).toMatchObject({ status: 'incomplete', reason: 'invalid-input' })
  })

  it('has an immutable production audit-only capability with no runtime toggle', () => {
    expect(DAEMON_REAP_PRODUCTION_CAPABILITY).toEqual({
      mode: 'audit-only',
      enforcementEnabled: false
    })
    expect(Object.isFrozen(DAEMON_REAP_PRODUCTION_CAPABILITY)).toBe(true)
    expect(JSON.stringify(DAEMON_REAP_PRODUCTION_CAPABILITY)).not.toContain('env')
  })
})

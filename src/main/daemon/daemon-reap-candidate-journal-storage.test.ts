import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DAEMON_REAP_JOURNAL_FILE_NAME,
  DAEMON_REAP_JOURNAL_MAX_BYTES,
  DAEMON_REAP_JOURNAL_MAX_ENTRIES,
  DAEMON_REAP_MAX_TRUSTED_CLOCK_ADVANCE_MS,
  DAEMON_REAP_MINIMUM_GRACE_MS,
  DaemonReapCandidateJournal,
  type DaemonReapCandidateJournalOptions,
  type DaemonReapCandidateFingerprint,
  type DaemonReapCandidateObservation
} from './daemon-reap-candidate-journal'
import type {
  DaemonReapJournalFileRead,
  DaemonReapJournalPersistence
} from './daemon-reap-candidate-journal-file'

class MemoryPersistence implements DaemonReapJournalPersistence {
  contents: string | null = null
  readOverride: DaemonReapJournalFileRead | null = null
  replaceSucceeds = true
  invalidateSucceeds = true
  readCount = 0
  replaceCount = 0

  async read(): Promise<DaemonReapJournalFileRead> {
    this.readCount += 1
    return (
      this.readOverride ??
      (this.contents === null ? { status: 'missing' } : { status: 'ok', contents: this.contents })
    )
  }

  async replaceAndReadBack(contents: string): Promise<boolean> {
    this.replaceCount += 1
    if (!this.replaceSucceeds) {
      return false
    }
    this.contents = contents
    this.readOverride = null
    return true
  }

  async invalidate(): Promise<boolean> {
    if (!this.invalidateSucceeds) {
      return false
    }
    this.contents = null
    this.readOverride = null
    return true
  }
}

function fingerprint(index = 0): DaemonReapCandidateFingerprint {
  return {
    protocolVersion: 22,
    daemonPid: 100,
    daemonStartedAt: 'daemon-start',
    sessionId: `session-${index}`,
    sessionPid: 1_000 + index,
    sessionStartedAt: `session-start-${index}`
  }
}

function observations(count: number): DaemonReapCandidateObservation[] {
  return Array.from({ length: count }, (_, index) => ({
    fingerprint: fingerprint(index),
    disposition: 'unclaimed'
  }))
}

describe('DaemonReapCandidateJournal storage safety', () => {
  let dir: string
  let path: string
  let nowMs: number

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'daemon-reap-journal-storage-'))
    path = join(dir, DAEMON_REAP_JOURNAL_FILE_NAME)
    nowMs = 1_700_000_000_000
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function journal(extra: Omit<DaemonReapCandidateJournalOptions, 'runtimeDir' | 'now'> = {}) {
    return new DaemonReapCandidateJournal({ runtimeDir: dir, now: () => nowMs, ...extra })
  }

  it('atomically writes a strict schema with user-only permissions where applicable', async () => {
    await journal().observeCompleteLaunch({ launchId: 'launch-1', observations: observations(1) })

    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({
      schemaVersion: 1,
      kind: 'active',
      entries: [{ fingerprint: fingerprint() }]
    })
    if (process.platform !== 'win32') {
      const mode = (await import('node:fs')).statSync(path).mode & 0o777
      expect(mode).toBe(0o600)
    }
    expect(existsSync(path)).toBe(true)
  })

  it.each([
    ['corrupt', '{', 'corrupt'],
    ['future schema', JSON.stringify({ schemaVersion: 2 }), 'future-schema'],
    [
      'extra field',
      JSON.stringify({ schemaVersion: 1, kind: 'reset-required', writtenAtMs: 1, extra: true }),
      'corrupt'
    ]
  ])('restarts a %s journal without maturity', async (_label, contents, reason) => {
    writeFileSync(path, contents, { mode: 0o600 })

    const result = await journal().observeCompleteLaunch({
      launchId: 'launch-2',
      observations: observations(1)
    })

    expect(result).toMatchObject({ reason, restartedObservation: true, matureCandidates: [] })
  })

  it('restarts an otherwise valid journal dated in the future', async () => {
    writeFileSync(
      path,
      JSON.stringify({ schemaVersion: 1, kind: 'reset-required', writtenAtMs: nowMs + 1 }),
      { mode: 0o600 }
    )

    const result = await journal().observeCompleteLaunch({
      launchId: 'launch',
      observations: observations(1)
    })

    expect(result).toMatchObject({ reason: 'clock-invalid', matureCandidates: [] })
  })

  it.each(['oversized', 'permission-invalid', 'not-regular'] as const)(
    'restarts a %s storage read on every platform',
    async (reason) => {
      const persistence = new MemoryPersistence()
      persistence.readOverride = { status: 'invalid', reason }
      const result = await journal({ testPersistence: persistence }).observeCompleteLaunch({
        launchId: 'launch',
        observations: observations(1)
      })
      expect(result).toMatchObject({ reason, matureCandidates: [] })
    }
  )

  it('repairs a real permission-invalid file where POSIX modes apply', async () => {
    if (process.platform === 'win32') {
      return
    }
    await journal().observeCompleteLaunch({ launchId: 'first', observations: observations(1) })
    chmodSync(path, 0o644)
    nowMs += DAEMON_REAP_MINIMUM_GRACE_MS
    const invalidMode = await journal().observeCompleteLaunch({
      launchId: 'second',
      observations: observations(1)
    })
    expect(invalidMode).toMatchObject({ reason: 'permission-invalid', matureCandidates: [] })
  })

  it('accepts count limit minus one and exact limit, then writes only a reset marker', async () => {
    const memory = new MemoryPersistence()
    const store = journal({
      testPersistence: memory,
      testLimits: { maxEntries: 2, maxBytes: DAEMON_REAP_JOURNAL_MAX_BYTES }
    })
    expect(
      (await store.observeCompleteLaunch({ launchId: 'a', observations: observations(1) }))
        .entryCount
    ).toBe(1)
    expect(
      (await store.observeCompleteLaunch({ launchId: 'b', observations: observations(2) }))
        .entryCount
    ).toBe(2)

    const overflow = await store.observeCompleteLaunch({
      launchId: 'c',
      observations: observations(3)
    })
    expect(overflow).toMatchObject({
      status: 'incomplete',
      reason: 'overflow',
      resetRequired: true,
      entryCount: 0
    })
    expect(JSON.parse(memory.contents!)).toEqual({
      schemaVersion: 1,
      kind: 'reset-required',
      writtenAtMs: nowMs
    })
  })

  it('enforces the compiled 4,096-entry boundary', async () => {
    const memory = new MemoryPersistence()
    const store = journal({ testPersistence: memory })
    const exact = await store.observeCompleteLaunch({
      launchId: 'exact',
      observations: observations(DAEMON_REAP_JOURNAL_MAX_ENTRIES)
    })
    expect(exact.entryCount).toBe(DAEMON_REAP_JOURNAL_MAX_ENTRIES)

    const overflow = await store.observeCompleteLaunch({
      launchId: 'overflow',
      observations: observations(DAEMON_REAP_JOURNAL_MAX_ENTRIES + 1)
    })
    expect(overflow).toMatchObject({ status: 'incomplete', resetRequired: true })
  })

  it('discards an entry-count-oversized journal before applying the current audit', async () => {
    const memory = new MemoryPersistence()
    const writer = journal({
      testPersistence: memory,
      testLimits: { maxEntries: 3, maxBytes: 4_096 }
    })
    await writer.observeCompleteLaunch({ launchId: 'old', observations: observations(3) })

    const reader = journal({
      testPersistence: memory,
      testLimits: { maxEntries: 2, maxBytes: 4_096 }
    })
    const result = await reader.observeCompleteLaunch({
      launchId: 'current',
      observations: observations(1)
    })

    expect(result).toMatchObject({ reason: 'oversized', entryCount: 1, matureCandidates: [] })
  })

  it('accepts the exact encoded byte limit and resets on the first byte over it', async () => {
    const sizing = new MemoryPersistence()
    await journal({ testPersistence: sizing }).observeCompleteLaunch({
      launchId: 'launch',
      observations: observations(1)
    })
    const exactBytes = Buffer.byteLength(sizing.contents!, 'utf8')
    for (const [maxBytes, expected] of [
      [exactBytes, 'recorded'],
      [exactBytes - 1, 'incomplete']
    ] as const) {
      const memory = new MemoryPersistence()
      const result = await journal({
        testPersistence: memory,
        testLimits: { maxEntries: 2, maxBytes }
      }).observeCompleteLaunch({ launchId: 'launch', observations: observations(1) })
      expect(result.status).toBe(expected)
    }
  })

  it('makes marker write/readback failure incomplete and preserves no authority', async () => {
    const memory = new MemoryPersistence()
    memory.replaceSucceeds = false
    const result = await journal({
      testPersistence: memory,
      testLimits: { maxEntries: 0, maxBytes: DAEMON_REAP_JOURNAL_MAX_BYTES }
    }).observeCompleteLaunch({ launchId: 'launch', observations: observations(1) })

    expect(result).toMatchObject({
      status: 'incomplete',
      reason: 'persistence-error',
      matureCandidates: [],
      enforcementAuthorized: false
    })
  })

  it('durably invalidates an old mature journal when the reset-marker replacement fails', async () => {
    const memory = new MemoryPersistence()
    const store = journal({
      testPersistence: memory,
      testLimits: { maxEntries: 1, maxBytes: DAEMON_REAP_JOURNAL_MAX_BYTES }
    })
    await store.observeCompleteLaunch({ launchId: 'launch-1', observations: observations(1) })
    nowMs += DAEMON_REAP_MINIMUM_GRACE_MS
    const mature = await store.observeCompleteLaunch({
      launchId: 'launch-2',
      observations: observations(1)
    })
    expect(mature.matureCandidates).toEqual([fingerprint()])

    memory.replaceSucceeds = false
    const failedReset = await store.observeCompleteLaunch({
      launchId: 'launch-3',
      observations: observations(2)
    })
    expect(failedReset).toMatchObject({ status: 'incomplete', reason: 'persistence-error' })
    expect(memory.contents).toBeNull()

    memory.replaceSucceeds = true
    const recovered = await store.observeCompleteLaunch({
      launchId: 'launch-4',
      observations: observations(1)
    })
    expect(recovered).toMatchObject({ reason: 'missing', matureCandidates: [] })
  })

  it('does not read or persist candidate IDs when secure storage is unavailable', async () => {
    const memory = new MemoryPersistence()
    const result = await journal({
      testPersistence: memory,
      testForceSecureStorageUnavailable: true
    }).observeCompleteLaunch({ launchId: 'windows-audit', observations: observations(1) })

    expect(result).toMatchObject({
      status: 'incomplete',
      reason: 'secure-storage-unavailable',
      matureCandidates: []
    })
    expect(memory.readCount).toBe(0)
    expect(memory.replaceCount).toBe(0)
    expect(memory.contents).toBeNull()
  })

  it('restarts after a reset marker once capacity returns', async () => {
    const memory = new MemoryPersistence()
    const overflow = journal({
      testPersistence: memory,
      testLimits: { maxEntries: 0, maxBytes: 1_000 }
    })
    await overflow.observeCompleteLaunch({ launchId: 'old', observations: observations(1) })

    const recovered = await journal({
      testPersistence: memory,
      testLimits: { maxEntries: 2, maxBytes: 1_000 }
    }).observeCompleteLaunch({ launchId: 'new', observations: observations(1) })
    expect(recovered).toMatchObject({
      reason: 'previous-reset',
      entryCount: 1,
      matureCandidates: []
    })
  })

  it.each([
    ['rollback', -1],
    ['implausible forward jump', DAEMON_REAP_MAX_TRUSTED_CLOCK_ADVANCE_MS + 1]
  ])('restarts on clock %s', async (_label, delta) => {
    await journal().observeCompleteLaunch({ launchId: 'first', observations: observations(1) })
    nowMs += delta
    const result = await journal().observeCompleteLaunch({
      launchId: 'second',
      observations: observations(1)
    })
    expect(result).toMatchObject({ reason: 'clock-invalid', matureCandidates: [] })
  })

  it('exports the compiled production limits', () => {
    expect(DAEMON_REAP_JOURNAL_MAX_ENTRIES).toBe(4_096)
    expect(DAEMON_REAP_JOURNAL_MAX_BYTES).toBe(4 * 1024 * 1024)
  })
})

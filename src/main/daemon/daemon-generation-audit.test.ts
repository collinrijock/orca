import { describe, expect, it, vi } from 'vitest'
import { runDaemonGenerationAudit } from './daemon-generation-audit'
import type { DaemonGenerationDiscovery } from './daemon-generation-inventory'
import type { DaemonReapJournalResult } from './daemon-reap-candidate-journal'
import type { DaemonReapCandidateObservation } from './daemon-reap-candidate-journal'
import type { SessionInfo } from './types'

function session(sessionId: string, pid: number): SessionInfo {
  return {
    sessionId,
    state: 'running',
    shellState: 'ready',
    isAlive: true,
    pid,
    cwd: '/tmp',
    cols: 80,
    rows: 24,
    createdAt: 1
  }
}

function recordedJournalResult(): DaemonReapJournalResult {
  return {
    status: 'recorded',
    reason: 'none',
    restartedObservation: false,
    entryCount: 1,
    effectiveGraceMs: 7 * 24 * 60 * 60 * 1000,
    matureCandidates: [],
    enforcementAuthorized: false
  }
}

function incompleteJournalResult(): DaemonReapJournalResult {
  return {
    ...recordedJournalResult(),
    status: 'incomplete',
    reason: 'audit-incomplete',
    entryCount: 0
  }
}

function discovery(args: {
  protocolVersion?: number
  sessions: SessionInfo[]
  relisted?: SessionInfo[]
  failedProtocols?: number[]
  endpointIdentities?: ({ pid: number; startedAtMs: number; launchNonce: string } | null)[]
}): DaemonGenerationDiscovery {
  const protocolVersion = args.protocolVersion ?? 22
  const identities = args.endpointIdentities ?? [
    { pid: 101, startedAtMs: 1_000, launchNonce: 'launch-a' }
  ]
  let identityIndex = 0
  return {
    generations: [
      {
        protocolVersion,
        sessions: args.sessions,
        adapter: {
          protocolVersion,
          listSessions: vi.fn(async () => args.relisted ?? args.sessions),
          getDaemonIdentity: vi.fn(
            () => identities[Math.min(identityIndex++, identities.length - 1)] ?? null
          )
        } as never
      }
    ],
    failedProtocols: args.failedProtocols ?? []
  }
}

function processResolver(tokens: Record<number, string>) {
  const probe = vi.fn(async (pids: readonly number[]) => ({
    status: 'success' as const,
    reason: 'none' as const,
    observations: pids.map((pid) =>
      tokens[pid]
        ? { pid, state: 'observed' as const, token: tokens[pid] }
        : { pid, state: 'not-observed' as const }
    ),
    externalProcessCount: 1
  }))
  return { probe, probeFreshAfterFence: probe }
}

describe('runDaemonGenerationAudit', () => {
  it('journals only stable fingerprints and classifies exact and wildcard ownership', async () => {
    const observeCompleteLaunch = vi.fn(
      async (_input: { launchId: string; observations: DaemonReapCandidateObservation[] }) =>
        recordedJournalResult()
    )
    const result = await runDaemonGenerationAudit({
      userDataPath: '/profiles',
      runtimeDir: '/runtime',
      launchId: 'launch-a',
      discovery: discovery({
        sessions: [session('unclaimed', 201), session('exact', 202), session('legacy', 203)]
      }),
      dependencies: {
        loadOwnershipSnapshot: async () => ({
          status: 'complete',
          claims: {
            exact: [{ protocolVersion: 22, sessionId: 'exact' }],
            legacyProtectedSessionIds: ['legacy']
          },
          sourceRevision: 'rev-a'
        }),
        readDaemonIdentity: async () => ({
          pid: 101,
          startedAtMs: 1_000,
          entryPath: null,
          appVersion: null,
          launchNonce: 'launch-a'
        }),
        processResolver: processResolver({
          101: 'daemon-start',
          201: 'session-a-start',
          202: 'session-b-start',
          203: 'session-c-start'
        }),
        journal: { incompleteAudit: incompleteJournalResult, observeCompleteLaunch }
      }
    })

    expect(result).toMatchObject({
      status: 'complete',
      stableSessionCount: 3,
      unclaimedCount: 1,
      claimedCount: 2
    })
    expect(observeCompleteLaunch).toHaveBeenCalledWith({
      launchId: 'launch-a',
      completeDaemonIncarnations: [
        { protocolVersion: 22, daemonPid: 101, daemonStartedAt: 'daemon-start' }
      ],
      observations: [
        expect.objectContaining({ disposition: 'unclaimed' }),
        expect.objectContaining({ disposition: 'claimed' }),
        expect.objectContaining({ disposition: 'protected' })
      ]
    })
    const firstFingerprint = observeCompleteLaunch.mock.calls[0]?.[0].observations[0].fingerprint
    expect(firstFingerprint).toEqual({
      protocolVersion: 22,
      daemonPid: 101,
      daemonStartedAt: 'daemon-start',
      sessionId: 'unclaimed',
      sessionPid: 201,
      sessionStartedAt: 'session-a-start'
    })
  })

  it('keeps the audit incomplete when any adapter discovery failed', async () => {
    const snapshot = vi.fn()
    const observe = vi.fn()
    const result = await runDaemonGenerationAudit({
      userDataPath: '/profiles',
      runtimeDir: '/runtime',
      discovery: discovery({ sessions: [], failedProtocols: [21] }),
      dependencies: {
        loadOwnershipSnapshot: snapshot,
        journal: { incompleteAudit: incompleteJournalResult, observeCompleteLaunch: observe }
      }
    })

    expect(result).toMatchObject({ status: 'incomplete', reasons: ['adapter-discovery-failed'] })
    expect(snapshot).not.toHaveBeenCalled()
    expect(observe).not.toHaveBeenCalled()
  })

  it('rejects a pid record that is not bound to the authenticated adapter endpoint', async () => {
    const observe = vi.fn()
    const result = await runDaemonGenerationAudit({
      userDataPath: '/profiles',
      runtimeDir: '/runtime',
      discovery: discovery({
        sessions: [session('unclaimed', 201)],
        endpointIdentities: [{ pid: 101, startedAtMs: 1_000, launchNonce: 'endpoint-launch' }]
      }),
      dependencies: {
        loadOwnershipSnapshot: async () => ({
          status: 'complete',
          claims: { exact: [], legacyProtectedSessionIds: [] },
          sourceRevision: 'rev-a'
        }),
        readDaemonIdentity: async () => ({
          pid: 101,
          startedAtMs: 1_000,
          entryPath: null,
          appVersion: null,
          launchNonce: 'stale-record'
        }),
        journal: { incompleteAudit: incompleteJournalResult, observeCompleteLaunch: observe }
      }
    })

    expect(result).toMatchObject({ status: 'incomplete', reasons: ['daemon-identity-unavailable'] })
    expect(observe).not.toHaveBeenCalled()
  })

  it('rejects an adapter that reconnects to a replacement daemon before relisting', async () => {
    const observe = vi.fn()
    const result = await runDaemonGenerationAudit({
      userDataPath: '/profiles',
      runtimeDir: '/runtime',
      discovery: discovery({
        sessions: [session('unclaimed', 201)],
        endpointIdentities: [
          { pid: 101, startedAtMs: 1_000, launchNonce: 'launch-a' },
          { pid: 102, startedAtMs: 2_000, launchNonce: 'launch-b' }
        ]
      }),
      dependencies: {
        loadOwnershipSnapshot: async () => ({
          status: 'complete',
          claims: { exact: [], legacyProtectedSessionIds: [] },
          sourceRevision: 'rev-a'
        }),
        readDaemonIdentity: async () => ({
          pid: 101,
          startedAtMs: 1_000,
          entryPath: null,
          appVersion: null,
          launchNonce: 'launch-a'
        }),
        processResolver: processResolver({ 101: 'daemon-start', 201: 'session-start' }),
        journal: { incompleteAudit: incompleteJournalResult, observeCompleteLaunch: observe }
      }
    })

    expect(result).toMatchObject({ status: 'incomplete', reasons: ['daemon-identity-changed'] })
    expect(observe).not.toHaveBeenCalled()
  })

  it('propagates fail-closed raw ownership reasons without probing processes', async () => {
    const resolver = processResolver({})
    const result = await runDaemonGenerationAudit({
      userDataPath: '/profiles',
      runtimeDir: '/runtime',
      discovery: discovery({ sessions: [session('kept', 201)] }),
      dependencies: {
        loadOwnershipSnapshot: async () => ({
          status: 'incomplete',
          reasons: ['profile-state-malformed-json']
        }),
        processResolver: resolver,
        journal: {
          incompleteAudit: incompleteJournalResult,
          observeCompleteLaunch: vi.fn()
        }
      }
    })

    expect(result).toMatchObject({
      status: 'incomplete',
      reasons: ['ownership:profile-state-malformed-json']
    })
    expect(resolver.probe).not.toHaveBeenCalled()
  })

  it('excludes sessions that disappear or change PID during the enrichment re-list', async () => {
    const observeCompleteLaunch = vi.fn(
      async (_input: { launchId: string; observations: DaemonReapCandidateObservation[] }) =>
        recordedJournalResult()
    )
    const result = await runDaemonGenerationAudit({
      userDataPath: '/profiles',
      runtimeDir: '/runtime',
      discovery: discovery({
        sessions: [session('gone', 201), session('reused', 202), session('stable', 203)],
        relisted: [session('reused', 302), session('stable', 203), session('new', 204)]
      }),
      dependencies: {
        loadOwnershipSnapshot: async () => ({
          status: 'complete',
          claims: { exact: [], legacyProtectedSessionIds: [] },
          sourceRevision: 'rev-a'
        }),
        readDaemonIdentity: async () => ({
          pid: 101,
          startedAtMs: 1_000,
          entryPath: null,
          appVersion: null,
          launchNonce: 'launch-a'
        }),
        processResolver: processResolver({
          101: 'daemon-start',
          201: 'gone-start',
          202: 'old-start',
          203: 'stable-start'
        }),
        journal: { incompleteAudit: incompleteJournalResult, observeCompleteLaunch }
      }
    })

    expect(result).toMatchObject({
      status: 'complete',
      initialSessionCount: 3,
      stableSessionCount: 1
    })
    expect(observeCompleteLaunch.mock.calls[0]?.[0].observations).toEqual([
      expect.objectContaining({
        fingerprint: expect.objectContaining({ sessionId: 'stable', sessionPid: 203 })
      })
    ])
  })

  it('does not journal a still-listed session without an observed incarnation', async () => {
    const observeCompleteLaunch = vi.fn()
    const result = await runDaemonGenerationAudit({
      userDataPath: '/profiles',
      runtimeDir: '/runtime',
      discovery: discovery({ sessions: [session('unknown', 201)] }),
      dependencies: {
        loadOwnershipSnapshot: async () => ({
          status: 'complete',
          claims: { exact: [], legacyProtectedSessionIds: [] },
          sourceRevision: 'rev-a'
        }),
        readDaemonIdentity: async () => ({
          pid: 101,
          startedAtMs: 1_000,
          entryPath: null,
          appVersion: null,
          launchNonce: 'launch-a'
        }),
        processResolver: processResolver({ 101: 'daemon-start' }),
        journal: { incompleteAudit: incompleteJournalResult, observeCompleteLaunch }
      }
    })

    expect(result).toMatchObject({
      status: 'incomplete',
      reasons: ['session-incarnation-unavailable']
    })
    expect(observeCompleteLaunch).not.toHaveBeenCalled()
  })
})

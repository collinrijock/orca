import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { getDaemonPidPath } from './daemon-spawner'
import { parseDaemonPidFile, type ParsedDaemonPid } from './daemon-health'
import {
  loadRawDaemonOwnershipSnapshot,
  type DaemonOwnershipSnapshot
} from './daemon-ownership-raw-snapshot'
import {
  processIncarnationResolver,
  type ProcessIncarnationResolver
} from './daemon-session-process-incarnation'
import {
  DaemonReapCandidateJournal,
  type DaemonReapAuditedIncarnation,
  type DaemonReapCandidateObservation,
  type DaemonReapJournalResult
} from './daemon-reap-candidate-journal'
import type {
  DaemonGenerationDiscovery,
  DaemonGenerationInventory
} from './daemon-generation-inventory'
import { PROTOCOL_VERSION } from './types'

type AuditJournal = Pick<DaemonReapCandidateJournal, 'incompleteAudit' | 'observeCompleteLaunch'>

export type DaemonGenerationAuditResult = {
  status: 'complete' | 'incomplete'
  reasons: string[]
  generationCount: number
  initialSessionCount: number
  stableSessionCount: number
  unclaimedCount: number
  claimedCount: number
  emptyLegacyGenerationCount: number
  journal: DaemonReapJournalResult
}

export type DaemonGenerationAuditDependencies = {
  loadOwnershipSnapshot: (userDataPath: string) => Promise<DaemonOwnershipSnapshot>
  readDaemonIdentity: (
    runtimeDir: string,
    protocolVersion: number
  ) => Promise<ParsedDaemonPid | null>
  processResolver: ProcessIncarnationResolver
  journal: AuditJournal
}

export async function runDaemonGenerationAudit(args: {
  userDataPath: string
  runtimeDir: string
  discovery: DaemonGenerationDiscovery
  launchId?: string
  dependencies?: Partial<DaemonGenerationAuditDependencies>
}): Promise<DaemonGenerationAuditResult> {
  const journal =
    args.dependencies?.journal ?? new DaemonReapCandidateJournal({ runtimeDir: args.runtimeDir })
  const incomplete = (
    reasons: string[],
    initialSessionCount: number
  ): DaemonGenerationAuditResult => ({
    status: 'incomplete',
    reasons: [...new Set(reasons)].sort(),
    generationCount: args.discovery.generations.length,
    initialSessionCount,
    stableSessionCount: 0,
    unclaimedCount: 0,
    claimedCount: 0,
    emptyLegacyGenerationCount: 0,
    journal: journal.incompleteAudit()
  })
  const initialSessionCount = args.discovery.generations.reduce(
    (count, generation) => count + generation.sessions.length,
    0
  )
  if (args.discovery.failedProtocols.length > 0) {
    return incomplete(['adapter-discovery-failed'], initialSessionCount)
  }

  const snapshotLoader = args.dependencies?.loadOwnershipSnapshot ?? loadRawDaemonOwnershipSnapshot
  const snapshot = await snapshotLoader(args.userDataPath)
  if (snapshot.status === 'incomplete') {
    return incomplete(
      snapshot.reasons.map((reason) => `ownership:${reason}`),
      initialSessionCount
    )
  }

  const readDaemonIdentity = args.dependencies?.readDaemonIdentity ?? readDaemonIdentityRecord
  const daemonRecords = new Map<number, ParsedDaemonPid>()
  for (const generation of args.discovery.generations) {
    const record = await readDaemonIdentity(args.runtimeDir, generation.protocolVersion)
    const endpointIdentity = generation.adapter.getDaemonIdentity()
    if (
      record === null ||
      endpointIdentity === null ||
      record.startedAtMs === null ||
      record.launchNonce === undefined ||
      record.pid !== endpointIdentity.pid ||
      record.startedAtMs !== endpointIdentity.startedAtMs ||
      record.launchNonce !== endpointIdentity.launchNonce
    ) {
      return incomplete(['daemon-identity-unavailable'], initialSessionCount)
    }
    daemonRecords.set(generation.protocolVersion, record)
  }

  const allPids = new Set<number>([...daemonRecords.values()].map((record) => record.pid))
  for (const generation of args.discovery.generations) {
    for (const session of generation.sessions) {
      if (!session.pid) {
        return incomplete(['session-identity-unavailable'], initialSessionCount)
      }
      allPids.add(session.pid)
    }
  }
  const resolver = args.dependencies?.processResolver ?? processIncarnationResolver
  const processProbe = await resolver.probe([...allPids])
  const processTokens = new Map(
    processProbe.observations.flatMap((observation) =>
      observation.state === 'observed' ? [[observation.pid, observation.token] as const] : []
    )
  )
  if (processProbe.status !== 'success') {
    return incomplete(['process-incarnation-probe-failed'], initialSessionCount)
  }

  const relisted = await relistGenerations(args.discovery.generations)
  if (relisted === null) {
    return incomplete(['adapter-relist-failed'], initialSessionCount)
  }
  for (const generation of args.discovery.generations) {
    const record = daemonRecords.get(generation.protocolVersion)!
    const identity = generation.adapter.getDaemonIdentity()
    // Why: a reconnect between inventories can bind this adapter to a replacement
    // daemon; that launch must start a fresh immutable audit.
    if (
      identity === null ||
      identity.pid !== record.pid ||
      identity.startedAtMs !== record.startedAtMs ||
      identity.launchNonce !== record.launchNonce
    ) {
      return incomplete(['daemon-identity-changed'], initialSessionCount)
    }
  }

  const exactClaims = new Set(
    snapshot.claims.exact.map(({ protocolVersion, sessionId }) =>
      exactClaimKey(protocolVersion, sessionId)
    )
  )
  const wildcardProtections = new Set(snapshot.claims.legacyProtectedSessionIds)
  const observations: DaemonReapCandidateObservation[] = []
  const completeDaemonIncarnations: DaemonReapAuditedIncarnation[] = []
  let claimedCount = 0
  for (const generation of args.discovery.generations) {
    const daemonPid = daemonRecords.get(generation.protocolVersion)!.pid
    const daemonStartedAt = processTokens.get(daemonPid)
    if (!daemonStartedAt) {
      return incomplete(['daemon-incarnation-unavailable'], initialSessionCount)
    }
    completeDaemonIncarnations.push({
      protocolVersion: generation.protocolVersion,
      daemonPid,
      daemonStartedAt
    })
    const freshById = new Map(
      relisted
        .get(generation.protocolVersion)!
        .map((session) => [session.sessionId, session] as const)
    )
    for (const session of generation.sessions) {
      const fresh = freshById.get(session.sessionId)
      // Why: a disappeared or replaced incarnation is not part of this immutable launch audit.
      if (!fresh || fresh.pid !== session.pid || !session.pid) {
        continue
      }
      const sessionStartedAt = processTokens.get(session.pid)
      if (!sessionStartedAt) {
        return incomplete(['session-incarnation-unavailable'], initialSessionCount)
      }
      const exact = exactClaims.has(exactClaimKey(generation.protocolVersion, session.sessionId))
      const protectedByLegacy = wildcardProtections.has(session.sessionId)
      const disposition = exact ? 'claimed' : protectedByLegacy ? 'protected' : 'unclaimed'
      if (disposition !== 'unclaimed') {
        claimedCount += 1
      }
      observations.push({
        fingerprint: {
          protocolVersion: generation.protocolVersion,
          daemonPid,
          daemonStartedAt,
          sessionId: session.sessionId,
          sessionPid: session.pid,
          sessionStartedAt
        },
        disposition
      })
    }
  }

  const journalResult = await journal.observeCompleteLaunch({
    launchId: args.launchId ?? randomUUID(),
    observations,
    completeDaemonIncarnations
  })
  if (journalResult.status === 'incomplete') {
    return {
      ...incomplete([`journal:${journalResult.reason}`], initialSessionCount),
      stableSessionCount: observations.length,
      journal: journalResult
    }
  }
  return {
    status: 'complete',
    reasons: [],
    generationCount: args.discovery.generations.length,
    initialSessionCount,
    stableSessionCount: observations.length,
    unclaimedCount: observations.length - claimedCount,
    claimedCount,
    emptyLegacyGenerationCount: countEmptyRelistedLegacyGenerations(args.discovery, relisted),
    journal: journalResult
  }
}

function countEmptyRelistedLegacyGenerations(
  discovery: DaemonGenerationDiscovery,
  relisted: Map<number, Awaited<ReturnType<DaemonGenerationInventory['adapter']['listSessions']>>>
): number {
  return discovery.generations.filter(
    (generation) =>
      generation.protocolVersion !== PROTOCOL_VERSION &&
      relisted.get(generation.protocolVersion)?.length === 0
  ).length
}

async function readDaemonIdentityRecord(
  runtimeDir: string,
  protocolVersion: number
): Promise<ParsedDaemonPid | null> {
  try {
    return parseDaemonPidFile(await readFile(getDaemonPidPath(runtimeDir, protocolVersion), 'utf8'))
  } catch {
    return null
  }
}

async function relistGenerations(
  generations: DaemonGenerationInventory[]
): Promise<Map<
  number,
  Awaited<ReturnType<DaemonGenerationInventory['adapter']['listSessions']>>
> | null> {
  const results = await Promise.allSettled(
    generations.map(async (generation) => ({
      protocolVersion: generation.protocolVersion,
      sessions: await generation.adapter.listSessions()
    }))
  )
  if (results.some((result) => result.status === 'rejected')) {
    return null
  }
  return new Map(
    results.flatMap((result) =>
      result.status === 'fulfilled'
        ? [[result.value.protocolVersion, result.value.sessions] as const]
        : []
    )
  )
}

function exactClaimKey(protocolVersion: number, sessionId: string): string {
  return `${protocolVersion}\0${sessionId}`
}

import { readFile, rm, stat } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'

import { describe, expect, it } from 'vitest'

import {
  lookupSshRelayArtifactCacheEntry,
  publishSshRelayArtifactCacheEntry,
  SSH_RELAY_ARTIFACT_CACHE_ENTRY_LIMITS
} from './ssh-relay-artifact-cache-entry'
import type { SshRelaySelectedArtifact } from './ssh-relay-artifact-selector'

type MeasurementIdentity = {
  tupleId: SshRelaySelectedArtifact['tupleId']
  contentId: SshRelaySelectedArtifact['contentId']
  os: SshRelaySelectedArtifact['tuple']['os']
  archive: SshRelaySelectedArtifact['tuple']['archive']
  entries: SshRelaySelectedArtifact['tuple']['entries']
}

const archivePath = process.env.ORCA_SSH_RELAY_FULL_SIZE_ARCHIVE
const identityPath = process.env.ORCA_SSH_RELAY_FULL_SIZE_IDENTITY
const cacheRoot = process.env.ORCA_SSH_RELAY_FULL_SIZE_OUTPUT
const hasMeasurementInput = Boolean(archivePath && identityPath && cacheRoot)

function measurementIdentity(input: unknown): MeasurementIdentity {
  if (
    typeof input !== 'object' ||
    input === null ||
    !('tupleId' in input) ||
    !('contentId' in input) ||
    !('os' in input) ||
    !('archive' in input) ||
    !('entries' in input) ||
    !Array.isArray(input.entries)
  ) {
    throw new Error('Full-size cache measurement identity is incomplete')
  }
  return input as MeasurementIdentity
}

function measurementArtifact(identity: MeasurementIdentity): SshRelaySelectedArtifact {
  const tuple = identity as unknown as SshRelaySelectedArtifact['tuple']
  // Why: this runner measures exact Actions artifact resources; it is never a product trust bypass.
  return Object.freeze({
    kind: 'selected',
    tupleId: identity.tupleId,
    contentId: identity.contentId,
    releaseTag: 'measurement-only',
    archive: Object.freeze({
      ...identity.archive,
      downloadUrl: 'https://invalid.example/measurement-only'
    }),
    tuple
  })
}

async function measure<T>(operation: () => Promise<T>): Promise<{
  result: T
  elapsedMs: number
  baselineRss: number
  peakRss: number
  incrementalRssBytes: number
}> {
  const baselineRss = process.memoryUsage().rss
  let peakRss = baselineRss
  const sample = (): void => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss)
  }
  const sampler = setInterval(sample, 1)
  const startedAt = performance.now()
  let result: T
  try {
    result = await operation()
  } finally {
    clearInterval(sampler)
    sample()
  }
  return {
    result,
    elapsedMs: performance.now() - startedAt,
    baselineRss,
    peakRss,
    incrementalRssBytes: Math.max(0, peakRss - baselineRss)
  }
}

describe.skipIf(!hasMeasurementInput)('SSH relay full-size immutable artifact cache entry', () => {
  it(
    'keeps cold publication and verified lookup within desktop resource budgets',
    async () => {
      const identity = measurementIdentity(
        JSON.parse(await readFile(identityPath as string, 'utf8')) as unknown
      )
      const artifact = measurementArtifact(identity)
      await expect(stat(cacheRoot as string)).rejects.toMatchObject({ code: 'ENOENT' })
      try {
        const cold = await measure(() =>
          publishSshRelayArtifactCacheEntry({
            cacheRoot: cacheRoot as string,
            artifact,
            archivePath: archivePath as string
          })
        )
        const warm = await measure(() =>
          lookupSshRelayArtifactCacheEntry({ cacheRoot: cacheRoot as string, artifact })
        )
        console.log(
          `ssh_relay_full_size_cache=${JSON.stringify({
            tupleId: identity.tupleId,
            archiveBytes: identity.archive.size,
            expandedBytes: identity.archive.expandedSize,
            files: identity.archive.fileCount,
            coldElapsedMs: cold.elapsedMs,
            coldIncrementalRssBytes: cold.incrementalRssBytes,
            warmElapsedMs: warm.elapsedMs,
            warmIncrementalRssBytes: warm.incrementalRssBytes
          })}`
        )
        expect(cold.result).toMatchObject({
          tupleId: identity.tupleId,
          contentId: identity.contentId,
          files: identity.archive.fileCount,
          expandedBytes: identity.archive.expandedSize
        })
        expect(warm.result).toEqual({ kind: 'hit', entry: cold.result })
        for (const measurement of [cold, warm]) {
          expect(measurement.elapsedMs).toBeLessThanOrEqual(
            SSH_RELAY_ARTIFACT_CACHE_ENTRY_LIMITS.transactionTimeoutMs
          )
          expect(measurement.incrementalRssBytes).toBeLessThanOrEqual(
            SSH_RELAY_ARTIFACT_CACHE_ENTRY_LIMITS.maximumIncrementalMemoryBytes
          )
        }
      } finally {
        await rm(cacheRoot as string, { recursive: true, force: true })
      }
    },
    SSH_RELAY_ARTIFACT_CACHE_ENTRY_LIMITS.transactionTimeoutMs * 2 + 10_000
  )
})

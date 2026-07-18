import { lstat, open } from 'node:fs/promises'
import { lstatSync } from 'node:fs'
import { setImmediate as yieldToEventLoop } from 'node:timers/promises'
import { getOrcaProfileDataFile, getOrcaProfileIndexPath } from './profile-index-store'
import {
  parseCommittedProfileState,
  type TransferProfileState,
  writeProfileState
} from './profile-project-state-file'
import { clearTargetTransferLineage } from './profile-project-transfer-lineage'
import { parseValidDaemonOwnershipCommit } from '../daemon/daemon-ownership-commit'
import { parseOwnershipProfileIndex } from '../daemon/daemon-ownership-profile-index'

const MAX_RECOVERY_PROFILES = 512
// Why: receipt cleanup is optional; deferring an unusually large profile is
// safer than parsing/stringifying tens of MiB in one Electron main-thread turn.
const MAX_RECOVERY_FILE_BYTES = 8 * 1024 * 1024
const MAX_RECOVERY_CAPTURE_BYTES = 32 * 1024 * 1024
const MAX_RECOVERY_INDEX_BYTES = 4 * 1024 * 1024
// Why: this is only a cheap skip for ordinary empty states; a miss merely
// defers receipt cleanup, while the committed parse below remains authoritative.
const NONEMPTY_LINEAGE_PATTERN = /"projectTransferLineage"\s*:\s*\[\s*\{/

type FileFingerprint = { dev: number; ino: number; size: number; mtimeMs: number }
type BoundedFileCapture = { contents: string; fingerprint: FileFingerprint }
type RawProfileState = {
  profileId: string
  contents: string | null
  fingerprint: FileFingerprint | null
}
type ProjectTransferRecoveryOptions = {
  maxProfiles?: number
  maxFileBytes?: number
  maxCaptureBytes?: number
  maxIndexBytes?: number
  yieldControl?: () => Promise<unknown>
}

export async function recoverCompletedProjectTransfers(
  userDataPath: string,
  options: ProjectTransferRecoveryOptions = {}
): Promise<void> {
  const maxProfiles = options.maxProfiles ?? MAX_RECOVERY_PROFILES
  const maxFileBytes = options.maxFileBytes ?? MAX_RECOVERY_FILE_BYTES
  const maxCaptureBytes = options.maxCaptureBytes ?? MAX_RECOVERY_CAPTURE_BYTES
  const maxIndexBytes = options.maxIndexBytes ?? MAX_RECOVERY_INDEX_BYTES
  const yieldControl = options.yieldControl ?? yieldToEventLoop
  let profiles: { id: string }[]
  let activeProfileId: string
  let capturedBytes = 0
  try {
    await yieldControl()
    const rawIndex = (
      await readBoundedRequiredFileCapture(getOrcaProfileIndexPath(userDataPath), maxIndexBytes)
    ).contents
    capturedBytes = Buffer.byteLength(rawIndex, 'utf8')
    const parsedIndex = parseOwnershipProfileIndex(rawIndex)
    if (!parsedIndex || capturedBytes > maxCaptureBytes) {
      throw new Error('invalid or oversized profile index')
    }
    profiles = parsedIndex.rows
    activeProfileId = parsedIndex.activeProfileId
  } catch (error) {
    console.warn(
      '[orca-profiles] Deferred project-transfer recovery index:',
      error instanceof Error ? error.message : String(error)
    )
    return
  }
  if (profiles.length > maxProfiles) {
    console.warn('[orca-profiles] Deferred project-transfer recovery: profile limit exceeded')
    return
  }
  const rawProfiles = new Map<string, RawProfileState>()
  try {
    for (const profile of profiles) {
      // Why: inactive-profile discovery is post-paint, but each filesystem turn
      // still yields so a large profile index cannot monopolize Electron's loop.
      await yieldControl()
      const raw = await readRawProfileState(profile.id, userDataPath, maxFileBytes)
      if (raw.contents !== null) {
        capturedBytes += Buffer.byteLength(raw.contents, 'utf8')
        if (capturedBytes > maxCaptureBytes) {
          throw new Error('capture limit exceeded')
        }
      }
      rawProfiles.set(profile.id, raw)
    }
  } catch (error) {
    console.warn(
      '[orca-profiles] Deferred project-transfer recovery scan:',
      error instanceof Error ? error.message : String(error)
    )
    return
  }

  const knownProfileIds = new Set(profiles.map((profile) => profile.id))
  const parsedProfiles = new Map<string, TransferProfileState>()
  const parseCapturedProfile = (profileId: string): TransferProfileState => {
    const cached = parsedProfiles.get(profileId)
    if (cached) {
      return cached
    }
    const contents = rawProfiles.get(profileId)?.contents
    if (!contents) {
      throw new Error(`missing captured profile state: ${profileId}`)
    }
    const parsed = parseCommittedProfileState(contents)
    parsedProfiles.set(profileId, parsed)
    return parsed
  }
  for (const targetProfile of profiles) {
    await yieldControl()
    try {
      if (targetProfile.id === activeProfileId) {
        // Why: the active Store owns this file; offline receipt cleanup could
        // overwrite newer in-memory state that has not reached disk yet.
        continue
      }
      const rawTarget = rawProfiles.get(targetProfile.id)?.contents ?? null
      if (!hasCommittedTargetReceipt(rawTarget, targetProfile.id)) {
        continue
      }
      const target = parseCapturedProfile(targetProfile.id)
      const recoverable = (target.daemonSessionOwnership?.projectTransferLineage ?? []).filter(
        (lineage) => {
          if (
            lineage.role !== 'target-lineage' ||
            lineage.targetProfileId !== targetProfile.id ||
            !knownProfileIds.has(lineage.sourceProfileId)
          ) {
            return false
          }
          const targetRepoId = lineage.targetRepoId ?? lineage.repoId
          if (!target.repos.some((repo) => repo.id === targetRepoId)) {
            return false
          }
          const rawSource = rawProfiles.get(lineage.sourceProfileId)?.contents ?? null
          if (!hasValidOwnershipCommit(rawSource)) {
            return false
          }
          const source = parseCapturedProfile(lineage.sourceProfileId)
          return !source.repos.some((repo) => repo.id === lineage.repoId)
        }
      )
      if (recoverable.length === 0) {
        continue
      }
      const recovered = recoverable.reduce(
        (state, lineage) => clearTargetTransferLineage(state, lineage.operationId),
        target
      )
      // Why: source absence plus the target receipt proves the move committed;
      // startup retries only the receipt cleanup that previously failed.
      if (!captureStillCurrent(rawProfiles.get(targetProfile.id), targetProfile.id, userDataPath)) {
        continue
      }
      writeProfileState(targetProfile.id, userDataPath, recovered)
    } catch (error) {
      console.warn(
        `[orca-profiles] Deferred project-transfer recovery for ${targetProfile.id}:`,
        error instanceof Error ? error.message : String(error)
      )
    }
  }
}

async function readBoundedRequiredFileCapture(
  path: string,
  maxBytes: number
): Promise<BoundedFileCapture> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new Error('invalid bounded file limit')
  }
  const metadata = await lstat(path)
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > maxBytes) {
    throw new Error('invalid bounded file')
  }
  const handle = await open(path, 'r')
  try {
    const openedMetadata = await handle.stat()
    if (
      !openedMetadata.isFile() ||
      openedMetadata.size > maxBytes ||
      openedMetadata.dev !== metadata.dev ||
      openedMetadata.ino !== metadata.ino
    ) {
      throw new Error('bounded file changed beyond limit')
    }
    const buffer = Buffer.allocUnsafe(maxBytes + 1)
    let captured = 0
    while (captured < buffer.length) {
      const { bytesRead } = await handle.read(buffer, captured, buffer.length - captured, captured)
      if (bytesRead === 0) {
        break
      }
      captured += bytesRead
    }
    if (captured > maxBytes) {
      throw new Error('bounded file changed beyond limit')
    }
    return {
      contents: buffer.subarray(0, captured).toString('utf8'),
      fingerprint: {
        dev: openedMetadata.dev,
        ino: openedMetadata.ino,
        size: openedMetadata.size,
        mtimeMs: openedMetadata.mtimeMs
      }
    }
  } finally {
    await handle.close()
  }
}

async function readRawProfileState(
  profileId: string,
  userDataPath: string,
  maxFileBytes: number
): Promise<RawProfileState> {
  const dataFile = getOrcaProfileDataFile(profileId, userDataPath)
  try {
    const capture = await readBoundedRequiredFileCapture(dataFile, maxFileBytes)
    return { profileId, ...capture }
  } catch (error) {
    if (isMissing(error)) {
      return { profileId, contents: null, fingerprint: null }
    }
    throw error
  }
}

function captureStillCurrent(
  raw: RawProfileState | undefined,
  profileId: string,
  userDataPath: string
): boolean {
  if (!raw?.fingerprint) {
    return false
  }
  try {
    const current = lstatSync(getOrcaProfileDataFile(profileId, userDataPath))
    return (
      current.isFile() &&
      !current.isSymbolicLink() &&
      current.dev === raw.fingerprint.dev &&
      current.ino === raw.fingerprint.ino &&
      current.size === raw.fingerprint.size &&
      current.mtimeMs === raw.fingerprint.mtimeMs
    )
  } catch {
    return false
  }
}

function hasCommittedTargetReceipt(contents: string | null, targetProfileId: string): boolean {
  if (!contents || !NONEMPTY_LINEAGE_PATTERN.test(contents)) {
    return false
  }
  try {
    const parsed = JSON.parse(contents) as Record<string, unknown>
    if (!parseValidDaemonOwnershipCommit(parsed)) {
      return false
    }
    const ownership = parsed.daemonSessionOwnership
    if (!isRecord(ownership) || !Array.isArray(ownership.projectTransferLineage)) {
      return false
    }
    return ownership.projectTransferLineage.some(
      (lineage) =>
        isRecord(lineage) &&
        lineage.role === 'target-lineage' &&
        lineage.targetProfileId === targetProfileId
    )
  } catch {
    return false
  }
}

function hasValidOwnershipCommit(contents: string | null): boolean {
  if (!contents) {
    return false
  }
  try {
    return Boolean(parseValidDaemonOwnershipCommit(JSON.parse(contents)))
  } catch {
    return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}

import { createHash } from 'node:crypto'
import { join } from 'node:path'
import {
  extractRawDaemonOwnership,
  type ExactDaemonSessionOwnership
} from './daemon-ownership-raw-extractor'
import { parseValidDaemonOwnershipCommit } from './daemon-ownership-commit'
import { parseOwnershipProfileIndex } from './daemon-ownership-profile-index'
import {
  defaultRawOwnershipSnapshotFilesystem,
  type RawOwnershipSnapshotFilesystem
} from './daemon-ownership-raw-filesystem'
export type { RawOwnershipSnapshotFilesystem } from './daemon-ownership-raw-filesystem'

const INDEX_FILE_NAME = 'orca-profile-index.json'
const PROFILE_DIRECTORY_NAME = 'profiles'
const STATE_FILE_NAME = 'orca-data.json'
const BACKUP_COUNT = 5
const MAX_CAPTURE_BYTES = 64 * 1024 * 1024
const MAX_CAPTURE_PROFILES = 512

export type DaemonClaimIndex = {
  exact: ExactDaemonSessionOwnership[]
  legacyProtectedSessionIds: string[]
}

export type DaemonOwnershipSnapshot =
  | { status: 'complete'; claims: DaemonClaimIndex; sourceRevision: string }
  | { status: 'incomplete'; reasons: string[] }

export type RawOwnershipSnapshotLimits = {
  maxCaptureBytes: number
  maxProfiles: number
}

type CapturedState = { id: string; indexed: boolean; initialized: boolean | null; files: FileSet }
type FileSet = { primary: string | null; backups: (string | null)[] }
type CapturedSources = {
  index: string | null
  indexBackup: string | null
  profileDirectoryNames: string[]
  profileDirectoryPresent: boolean
  profiles: CapturedState[]
  legacy: FileSet
  revision: string
}

export async function loadRawDaemonOwnershipSnapshot(
  userDataPath: string,
  filesystem: RawOwnershipSnapshotFilesystem = defaultRawOwnershipSnapshotFilesystem,
  limits: RawOwnershipSnapshotLimits = {
    maxCaptureBytes: MAX_CAPTURE_BYTES,
    maxProfiles: MAX_CAPTURE_PROFILES
  }
): Promise<DaemonOwnershipSnapshot> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let before: CapturedSources
    let after: CapturedSources
    try {
      before = await captureSources(userDataPath, filesystem, limits)
      const result = extractCapturedSources(before)
      after = await captureSources(userDataPath, filesystem, limits)
      if (before.revision === after.revision) {
        return result.status === 'complete'
          ? { ...result, sourceRevision: before.revision }
          : result
      }
    } catch (error) {
      return {
        status: 'incomplete',
        reasons: [
          error instanceof OwnershipCaptureLimitError
            ? error.reason
            : 'filesystem-enumeration-failed'
        ]
      }
    }
  }
  return { status: 'incomplete', reasons: ['source-manifest-changed'] }
}

async function captureSources(
  userDataPath: string,
  filesystem: RawOwnershipSnapshotFilesystem,
  limits: RawOwnershipSnapshotLimits
): Promise<CapturedSources> {
  let capturedBytes = 0
  const readBounded = async (path: string): Promise<string | null> => {
    const content = await filesystem.readOptionalFile(path)
    if (content !== null) {
      capturedBytes += Buffer.byteLength(content, 'utf8')
      if (capturedBytes > limits.maxCaptureBytes) {
        throw new OwnershipCaptureLimitError('ownership-source-budget-exceeded')
      }
    }
    return content
  }
  const indexPath = join(userDataPath, INDEX_FILE_NAME)
  const profileDirectoryNames = await filesystem.listProfileDirectories(
    join(userDataPath, PROFILE_DIRECTORY_NAME)
  )
  const index = await readBounded(indexPath)
  const indexBackup = await readBounded(`${indexPath}.bak`)
  const parsedIndex = index ? parseOwnershipProfileIndex(index) : null
  const directoryNames = profileDirectoryNames ?? []
  const profileIds = new Set(directoryNames)
  for (const row of parsedIndex?.rows ?? []) {
    profileIds.add(row.id)
  }
  if (profileIds.size > limits.maxProfiles) {
    throw new OwnershipCaptureLimitError('ownership-profile-budget-exceeded')
  }
  const profiles: CapturedState[] = []
  for (const id of [...profileIds].sort()) {
    const indexRow = parsedIndex?.rows.find((row) => row.id === id)
    const primaryPath = join(userDataPath, PROFILE_DIRECTORY_NAME, id, STATE_FILE_NAME)
    profiles.push({
      id,
      indexed: Boolean(indexRow),
      initialized: indexRow?.initialized ?? null,
      files: await captureFileSet(primaryPath, readBounded)
    })
  }
  const legacy = await captureFileSet(join(userDataPath, STATE_FILE_NAME), readBounded)
  const sourceWithoutRevision = {
    index,
    indexBackup,
    profileDirectoryNames: directoryNames,
    profileDirectoryPresent: profileDirectoryNames !== null,
    profiles,
    legacy
  }
  return { ...sourceWithoutRevision, revision: hashSources(sourceWithoutRevision) }
}

async function captureFileSet(
  primaryPath: string,
  readOptionalFile: RawOwnershipSnapshotFilesystem['readOptionalFile']
): Promise<FileSet> {
  const primary = await readOptionalFile(primaryPath)
  const backups: (string | null)[] = []
  for (let index = 0; index < BACKUP_COUNT; index += 1) {
    backups.push(await readOptionalFile(`${primaryPath}.bak.${index}`))
  }
  return { primary, backups }
}

class OwnershipCaptureLimitError extends Error {
  constructor(readonly reason: string) {
    super(reason)
  }
}

function extractCapturedSources(
  sources: CapturedSources
):
  | Omit<Extract<DaemonOwnershipSnapshot, { status: 'complete' }>, 'sourceRevision'>
  | Extract<DaemonOwnershipSnapshot, { status: 'incomplete' }> {
  const reasons = new Set<string>()
  const primaryIndex = sources.index ? parseOwnershipProfileIndex(sources.index) : null
  if (sources.index && !primaryIndex) {
    reasons.add('profile-index-malformed')
  }
  if (sources.indexBackup && !parseOwnershipProfileIndex(sources.indexBackup)) {
    reasons.add('profile-index-backup-malformed')
  }
  if (!sources.index && (sources.indexBackup || sources.profileDirectoryNames.length > 0)) {
    reasons.add('profile-index-missing')
  }
  if (
    primaryIndex &&
    !sources.profileDirectoryPresent &&
    primaryIndex.rows.some(({ initialized }) => initialized !== false)
  ) {
    reasons.add('profiles-directory-missing')
  }
  if (
    !sources.index &&
    sources.profileDirectoryNames.length === 0 &&
    sources.legacy.primary === null &&
    sources.legacy.backups.every((backup) => backup === null)
  ) {
    reasons.add('ownership-sources-missing')
  }

  const exact = new Map<string, ExactDaemonSessionOwnership>()
  const protectedIds = new Set<string>()
  for (const profile of sources.profiles) {
    extractStateSource(
      profile.files,
      profile.indexed,
      profile.initialized,
      reasons,
      exact,
      protectedIds
    )
  }
  extractStateSource(sources.legacy, false, false, reasons, exact, protectedIds, true)
  if (reasons.size > 0) {
    return { status: 'incomplete', reasons: [...reasons].sort() }
  }
  return {
    status: 'complete',
    claims: {
      exact: [...exact.values()],
      legacyProtectedSessionIds: [...protectedIds]
    }
  }
}

function extractStateSource(
  files: FileSet,
  indexed: boolean,
  initialized: boolean | null,
  reasons: Set<string>,
  exact: Map<string, ExactDaemonSessionOwnership>,
  protectedIds: Set<string>,
  optionalLegacy = false
): void {
  if (files.primary === null) {
    if (files.backups.some((backup) => backup !== null)) {
      reasons.add('state-backup-unverifiable')
    } else if (!optionalLegacy && (!indexed || initialized !== false)) {
      reasons.add('profile-state-missing')
    }
    return
  }
  let raw: unknown
  try {
    raw = JSON.parse(files.primary)
  } catch {
    reasons.add('profile-state-malformed-json')
    if (files.backups.some((backup) => backup !== null)) {
      reasons.add('state-backup-unverifiable')
    }
    return
  }
  if (!parseValidDaemonOwnershipCommit(raw)) {
    reasons.add('state-commit-unverifiable')
    return
  }
  if (
    typeof raw === 'object' &&
    raw !== null &&
    Object.prototype.hasOwnProperty.call(raw, 'daemonOwnershipCommitInvalid')
  ) {
    // Why: Store may preserve availability after detecting raw corruption, but
    // its newly signed normalized state must never turn that corruption into absence.
    reasons.add('state-commit-unverifiable')
    return
  }
  const extracted = extractRawDaemonOwnership(raw)
  if (extracted.status === 'incomplete') {
    reasons.add(`profile-${extracted.reason}`)
    return
  }
  for (const claim of extracted.ownership.exactClaims) {
    exact.set(`${claim.protocolVersion}\0${claim.sessionId}`, claim)
  }
  for (const sessionId of extracted.ownership.legacyProtectedSessionIds) {
    protectedIds.add(sessionId)
  }
}

function hashSources(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

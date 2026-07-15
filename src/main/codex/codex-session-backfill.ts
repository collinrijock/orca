import {
  appendFileSync,
  constants,
  copyFileSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join, relative, sep } from 'node:path'
import { writeFileAtomically } from '../codex-accounts/fs-utils'
import {
  getCodexSessionBackfillStateDirPath,
  getOrcaManagedCodexHomePath,
  getSystemCodexHomePath
} from './codex-home-paths'
import { listCodexSessionJsonlFilesIncrementally } from './codex-session-file-listing'
import type { CodexSessionBridgeIncrementalOptions } from './codex-session-file-listing'

// Why: bump to re-run the backfill for every host after a layout or semantics
// change; the run itself stays skip-existing so re-runs never overwrite.
const CODEX_SESSION_BACKFILL_MARKER_VERSION = 1

export type CodexSessionBackfillSummary = {
  scannedFiles: number
  linkedFiles: number
  copiedFiles: number
  skippedExistingFiles: number
  skippedUnexpectedFiles: number
  skippedSymlinkFiles: number
  failedDirectories: number
  failedFiles: number
}

export type CodexSessionBackfillPaths = {
  managedSessionsRoot: string
  systemSessionsRoot: string
  auditLogPath: string
  markerPath: string
}

let backgroundBackfillTask: Promise<CodexSessionBackfillSummary | null> | null = null

/**
 * Resolves the production source/target/state paths for the session backfill.
 *
 * `systemCodexHomePathOverride` mirrors the session bridge: users who run
 * Codex with a custom CODEX_HOME need their history placed where their own
 * `codex resume` actually looks.
 */
export function resolveCodexSessionBackfillPaths(
  systemCodexHomePathOverride?: string
): CodexSessionBackfillPaths {
  const stateDir = getCodexSessionBackfillStateDirPath()
  return {
    managedSessionsRoot: join(getOrcaManagedCodexHomePath(), 'sessions'),
    systemSessionsRoot: join(systemCodexHomePathOverride || getSystemCodexHomePath(), 'sessions'),
    auditLogPath: join(stateDir, 'audit.jsonl'),
    markerPath: join(stateDir, 'backfill-complete.json')
  }
}

/**
 * Starts the once-per-host background backfill of managed-home session files
 * into the user's real Codex home.
 *
 * Concurrent callers share one in-flight task; a completed-marker host resolves
 * to null without walking the sessions tree.
 */
export function startCodexSessionBackfillInBackground(
  options: CodexSessionBridgeIncrementalOptions = {},
  systemCodexHomePathOverride?: string
): Promise<CodexSessionBackfillSummary | null> {
  if (backgroundBackfillTask) {
    return backgroundBackfillTask
  }
  const task = runCodexSessionBackfillOncePerHost(options, systemCodexHomePathOverride).catch(
    (error: unknown) => {
      console.warn('[codex-session-backfill] Background session backfill failed:', error)
      return null
    }
  )
  backgroundBackfillTask = task
  void task.finally(() => {
    if (backgroundBackfillTask === task) {
      backgroundBackfillTask = null
    }
  })
  return task
}

async function runCodexSessionBackfillOncePerHost(
  options: CodexSessionBridgeIncrementalOptions,
  systemCodexHomePathOverride?: string
): Promise<CodexSessionBackfillSummary | null> {
  const paths = resolveCodexSessionBackfillPaths(systemCodexHomePathOverride)
  if (hasCompletedBackfillMarker(paths.markerPath, paths.systemSessionsRoot)) {
    return null
  }
  const summary = await backfillManagedCodexSessionsIntoSystemHome(paths, options)
  // Why: per-file failures (locked or unreadable files) leave the marker unset
  // so the next startup retries; skip-existing keeps those retries cheap.
  if (summary.failedFiles === 0 && summary.failedDirectories === 0) {
    writeBackfillMarker(paths.markerPath, paths.systemSessionsRoot, summary)
  }
  return summary
}

/**
 * Backfills managed-home session rollout files into the real Codex home.
 *
 * Non-destructive by contract: existing target files are always skipped, and
 * nothing in either home is deleted or moved. Hardlink first so resume sees
 * one physical JSONL log; copy is the cross-volume fallback.
 */
export async function backfillManagedCodexSessionsIntoSystemHome(
  paths: CodexSessionBackfillPaths,
  options: CodexSessionBridgeIncrementalOptions = {}
): Promise<CodexSessionBackfillSummary> {
  const summary: CodexSessionBackfillSummary = {
    scannedFiles: 0,
    linkedFiles: 0,
    copiedFiles: 0,
    skippedExistingFiles: 0,
    skippedUnexpectedFiles: 0,
    skippedSymlinkFiles: 0,
    failedDirectories: 0,
    failedFiles: 0
  }
  if (existsSync(paths.managedSessionsRoot)) {
    for await (const managedSessionFilePath of listCodexSessionJsonlFilesIncrementally(
      paths.managedSessionsRoot,
      options,
      (directoryPath, error) => {
        // Why: a partial walk must remain retryable; otherwise an unreadable
        // date directory would be silently omitted behind a completion marker.
        summary.failedDirectories += 1
        appendAuditRecord(paths.auditLogPath, {
          action: 'scan-failed',
          source: directoryPath,
          error: describeError(error)
        })
      }
    )) {
      summary.scannedFiles += 1
      if (!isCodexRolloutPath(paths.managedSessionsRoot, managedSessionFilePath)) {
        summary.skippedUnexpectedFiles += 1
        continue
      }
      backfillOneManagedSessionFile(paths, managedSessionFilePath, summary)
    }
  }
  appendAuditRecord(paths.auditLogPath, { action: 'run-summary', ...summary })
  return summary
}

function isCodexRolloutPath(sessionsRoot: string, filePath: string): boolean {
  const pathParts = relative(sessionsRoot, filePath).split(sep)
  if (pathParts.length !== 4) {
    return false
  }
  const [year, month, day, fileName] = pathParts
  return (
    /^\d{4}$/.test(year) &&
    /^\d{2}$/.test(month) &&
    /^\d{2}$/.test(day) &&
    /^rollout-.+\.jsonl$/.test(fileName)
  )
}

function backfillOneManagedSessionFile(
  paths: CodexSessionBackfillPaths,
  managedSessionFilePath: string,
  summary: CodexSessionBackfillSummary
): void {
  if (isSymbolicLink(managedSessionFilePath)) {
    // Why: bridge-created symlinks already point at a file in the user's own
    // home; materializing them here could duplicate a foreign tree.
    summary.skippedSymlinkFiles += 1
    return
  }
  const relativePath = relative(paths.managedSessionsRoot, managedSessionFilePath)
  const systemSessionFilePath = join(paths.systemSessionsRoot, relativePath)
  if (pathEntryExists(systemSessionFilePath)) {
    summary.skippedExistingFiles += 1
    return
  }

  try {
    mkdirSync(dirname(systemSessionFilePath), { recursive: true })
    linkSync(managedSessionFilePath, systemSessionFilePath)
    summary.linkedFiles += 1
    appendAuditRecord(paths.auditLogPath, {
      action: 'hardlink',
      source: managedSessionFilePath,
      target: systemSessionFilePath
    })
  } catch (linkError) {
    if (isExistsError(linkError)) {
      summary.skippedExistingFiles += 1
      return
    }
    try {
      // Why: cross-volume copies are staged so failures cannot strand a
      // truncated rollout, then installed without overwriting collisions.
      copySessionFileWithoutOverwrite(managedSessionFilePath, systemSessionFilePath)
      summary.copiedFiles += 1
      appendAuditRecord(paths.auditLogPath, {
        action: 'copy',
        source: managedSessionFilePath,
        target: systemSessionFilePath
      })
    } catch (copyError) {
      if (isExistsError(copyError)) {
        summary.skippedExistingFiles += 1
        return
      }
      summary.failedFiles += 1
      appendAuditRecord(paths.auditLogPath, {
        action: 'failed',
        source: managedSessionFilePath,
        target: systemSessionFilePath,
        error: describeError(copyError),
        linkError: describeError(linkError)
      })
    }
  }
}

function copySessionFileWithoutOverwrite(sourcePath: string, targetPath: string): void {
  const temporaryPath = join(dirname(targetPath), `.orca-backfill-${randomUUID()}.tmp`)
  // Why: stage cross-volume copies away from the rollout filename so a failed
  // copy cannot strand a truncated session that a later retry would skip.
  writeFileSync(temporaryPath, '', { encoding: 'utf-8', flag: 'wx', mode: 0o600 })
  try {
    copyFileSync(sourcePath, temporaryPath)
    try {
      // Why: this same-volume hardlink atomically installs the staged copy
      // without risking a collision overwrite after an EXDEV fallback.
      linkSync(temporaryPath, targetPath)
    } catch (installLinkError) {
      if (isExistsError(installLinkError)) {
        throw installLinkError
      }
      // Some target filesystems do not support hardlinks at all. COPYFILE_EXCL
      // preserves the collision contract while retaining the staged snapshot.
      copyFileSync(temporaryPath, targetPath, constants.COPYFILE_EXCL)
    }
  } finally {
    try {
      rmSync(temporaryPath, { force: true })
    } catch (error) {
      // Why: cleanup trouble must not misreport a successfully installed
      // rollout as a copy failure; the .tmp file is ignored by Codex.
      console.warn('[codex-session-backfill] Failed to remove staged copy:', temporaryPath, error)
    }
  }
}

function isSymbolicLink(filePath: string): boolean {
  try {
    return lstatSync(filePath).isSymbolicLink()
  } catch {
    return false
  }
}

/** Existence via lstat so a broken symlink at the target still counts as taken. */
function pathEntryExists(entryPath: string): boolean {
  try {
    lstatSync(entryPath)
    return true
  } catch {
    return false
  }
}

function isExistsError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'EEXIST'
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function appendAuditRecord(auditLogPath: string, record: Record<string, unknown>): void {
  try {
    mkdirSync(dirname(auditLogPath), { recursive: true })
    appendFileSync(
      auditLogPath,
      `${JSON.stringify({ at: new Date().toISOString(), ...record })}\n`,
      {
        encoding: 'utf-8'
      }
    )
  } catch (error) {
    // Why: the audit trail is diagnostics; losing a line must not fail the
    // backfill or leave a half-linked tree unrecorded in the summary counts.
    console.warn('[codex-session-backfill] Failed to append audit record:', error)
  }
}

function hasCompletedBackfillMarker(markerPath: string, systemSessionsRoot: string): boolean {
  try {
    const parsed: unknown = JSON.parse(readFileSync(markerPath, 'utf-8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return false
    }
    const marker = parsed as { version?: unknown; systemSessionsRoot?: unknown }
    // Why: changing the configured real Codex home must backfill the new
    // target instead of honoring a marker written for a different history.
    return (
      marker.version === CODEX_SESSION_BACKFILL_MARKER_VERSION &&
      marker.systemSessionsRoot === systemSessionsRoot
    )
  } catch {
    return false
  }
}

function writeBackfillMarker(
  markerPath: string,
  systemSessionsRoot: string,
  summary: CodexSessionBackfillSummary
): void {
  mkdirSync(dirname(markerPath), { recursive: true })
  writeFileAtomically(
    markerPath,
    `${JSON.stringify(
      {
        version: CODEX_SESSION_BACKFILL_MARKER_VERSION,
        systemSessionsRoot,
        completedAt: Date.now(),
        summary
      },
      null,
      2
    )}\n`
  )
}

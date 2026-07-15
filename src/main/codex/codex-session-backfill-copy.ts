import { randomUUID } from 'node:crypto'
import { copyFile, link, lstat, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export async function copySessionFileWithoutOverwrite(
  sourcePath: string,
  targetPath: string
): Promise<void> {
  const temporaryPath = join(dirname(targetPath), `.orca-backfill-${randomUUID()}.tmp`)
  // Why: stage cross-volume copies away from the rollout filename so a failed
  // copy cannot strand a truncated session that a later retry would skip.
  await writeFile(temporaryPath, '', { encoding: 'utf-8', flag: 'wx', mode: 0o600 })
  try {
    await copyFile(sourcePath, temporaryPath)
    try {
      // Why: this same-volume hardlink atomically installs the staged copy
      // without risking a collision overwrite after an EXDEV fallback.
      await link(temporaryPath, targetPath)
    } catch (installLinkError) {
      if (isExistsError(installLinkError)) {
        throw installLinkError
      }
      // Why: some target filesystems support no hardlinks at all. Install the
      // fully-staged copy with an atomic rename — never a raw copy into the
      // rollout filename — so an interrupted install cannot strand a truncated
      // session that a later run skips as already-present. Re-check existence
      // first because rename, unlike the hardlink above, would clobber a target
      // that appeared mid-run.
      if (await pathEntryExists(targetPath)) {
        throw makeTargetExistsError(targetPath)
      }
      await rename(temporaryPath, targetPath)
    }
  } finally {
    try {
      await rm(temporaryPath, { force: true })
    } catch (error) {
      // Why: cleanup trouble must not misreport a successfully installed
      // rollout as a copy failure; the .tmp file is ignored by Codex.
      console.warn('[codex-session-backfill] Failed to remove staged copy:', temporaryPath, error)
    }
  }
}

/** Existence via lstat so a broken symlink at the target still counts as taken. */
async function pathEntryExists(entryPath: string): Promise<boolean> {
  try {
    await lstat(entryPath)
    return true
  } catch {
    return false
  }
}

function isExistsError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'EEXIST'
}

/** EEXIST so a rename-install collision routes to the skip path, not a failure. */
function makeTargetExistsError(targetPath: string): NodeJS.ErrnoException {
  const error = new Error(`EEXIST: backfill target already exists: ${targetPath}`)
  ;(error as NodeJS.ErrnoException).code = 'EEXIST'
  return error
}

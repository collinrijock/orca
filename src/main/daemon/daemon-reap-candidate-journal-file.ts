import { randomUUID } from 'node:crypto'
import { open, lstat, mkdir, readFile, rename, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export type DaemonReapJournalFileRead =
  | { status: 'missing' }
  | { status: 'invalid'; reason: 'oversized' | 'permission-invalid' | 'not-regular' }
  | { status: 'ok'; contents: string }

export type DaemonReapJournalPersistence = {
  read(maxBytes: number): Promise<DaemonReapJournalFileRead>
  replaceAndReadBack(contents: string, maxBytes: number): Promise<boolean>
  invalidate(maxBytes: number): Promise<boolean>
}

export function createDaemonReapJournalFilePersistence(
  runtimeDir: string,
  fileName: string
): DaemonReapJournalPersistence {
  const journalPath = join(runtimeDir, fileName)

  const read = async (maxBytes: number): Promise<DaemonReapJournalFileRead> => {
    let stat
    try {
      stat = await lstat(journalPath)
    } catch (error) {
      return isMissing(error) ? { status: 'missing' } : { status: 'invalid', reason: 'not-regular' }
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
      return { status: 'invalid', reason: 'not-regular' }
    }
    if (stat.size > maxBytes) {
      return { status: 'invalid', reason: 'oversized' }
    }
    if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
      return { status: 'invalid', reason: 'permission-invalid' }
    }
    try {
      const contents = await readFile(journalPath, 'utf8')
      return Buffer.byteLength(contents, 'utf8') <= maxBytes
        ? { status: 'ok', contents }
        : { status: 'invalid', reason: 'oversized' }
    } catch {
      return { status: 'invalid', reason: 'not-regular' }
    }
  }

  const replaceAndReadBack = async (contents: string, maxBytes: number): Promise<boolean> => {
    if (Buffer.byteLength(contents, 'utf8') > maxBytes) {
      return false
    }
    await mkdir(runtimeDir, { recursive: true, mode: 0o700 })
    const tempPath = join(dirname(journalPath), `.${fileName}.${randomUUID()}.tmp`)
    let handle: Awaited<ReturnType<typeof open>> | null = null
    try {
      handle = await open(tempPath, 'wx', 0o600)
      await handle.writeFile(contents, 'utf8')
      await handle.chmod(0o600)
      await handle.sync()
      await handle.close()
      handle = null
      await rename(tempPath, journalPath)
      if (process.platform !== 'win32') {
        const directory = await open(dirname(journalPath), 'r')
        try {
          await directory.sync()
        } finally {
          await directory.close()
        }
      }
      const readBack = await read(maxBytes)
      return readBack.status === 'ok' && readBack.contents === contents
    } catch {
      return false
    } finally {
      if (handle) {
        await handle.close().catch(() => {})
      }
      await unlink(tempPath).catch(() => {})
    }
  }

  const invalidate = async (maxBytes: number): Promise<boolean> => {
    try {
      await unlink(journalPath)
      if (process.platform !== 'win32') {
        const directory = await open(dirname(journalPath), 'r')
        try {
          await directory.sync()
        } finally {
          await directory.close()
        }
      }
    } catch (error) {
      if (!isMissing(error)) {
        return false
      }
    }
    return (await read(maxBytes)).status === 'missing'
  }

  return { read, replaceAndReadBack, invalidate }
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
}

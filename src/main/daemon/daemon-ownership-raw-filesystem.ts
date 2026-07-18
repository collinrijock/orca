import { lstat, readFile, readdir } from 'node:fs/promises'
import { OWNERSHIP_PROFILE_ID_PATTERN } from './daemon-ownership-profile-index'

const MAX_RAW_FILE_BYTES = 32 * 1024 * 1024

export type RawOwnershipSnapshotFilesystem = {
  readOptionalFile: (path: string) => Promise<string | null>
  listProfileDirectories: (path: string) => Promise<string[] | null>
}

export const defaultRawOwnershipSnapshotFilesystem: RawOwnershipSnapshotFilesystem = {
  readOptionalFile: async (path) => {
    try {
      const metadata = await lstat(path)
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_RAW_FILE_BYTES) {
        throw new Error('invalid raw ownership source')
      }
      const content = await readFile(path, 'utf8')
      if (Buffer.byteLength(content, 'utf8') > MAX_RAW_FILE_BYTES) {
        throw new Error('raw ownership source changed beyond byte limit')
      }
      return content
    } catch (error) {
      if (isMissing(error)) {
        return null
      }
      throw error
    }
  },
  listProfileDirectories: async (path) => {
    try {
      const metadata = await lstat(path)
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
        throw new Error('profile root is not an authoritative directory')
      }
      const entries = await readdir(path, { withFileTypes: true })
      const directories: string[] = []
      for (const entry of entries) {
        if (entry.isSymbolicLink()) {
          throw new Error('profile directory symlink is not authoritative')
        }
        if (entry.isDirectory()) {
          if (!OWNERSHIP_PROFILE_ID_PATTERN.test(entry.name)) {
            throw new Error('invalid profile directory name')
          }
          directories.push(entry.name)
        }
      }
      return directories.sort()
    } catch (error) {
      if (isMissing(error)) {
        return null
      }
      throw error
    }
  }
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}

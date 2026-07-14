import type { Dirent } from 'node:fs'
import { opendir, realpath, stat } from 'node:fs/promises'
import { join } from 'node:path'

const MAXIMUM_PLUGIN_SCAN_DEPTH = 9
const MAXIMUM_PLUGIN_SCAN_ENTRIES = 4_096

export type KnownPluginSkillCandidate = {
  name: string
  path: string
}

export type KnownPluginSkillScan = {
  candidates: KnownPluginSkillCandidate[]
  incompletePaths: string[]
}

function errorCode(error: unknown): string | null {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : null
}

export async function scanKnownPluginSkillCandidates(
  rootPath: string,
  knownNames: ReadonlySet<string>
): Promise<KnownPluginSkillScan> {
  const candidates: KnownPluginSkillCandidate[] = []
  const incompletePaths = new Set<string>()
  const visited = new Set<string>()
  let entryCount = 0
  let limitReached = false

  async function visit(directory: string, depth: number): Promise<void> {
    if (limitReached || depth > MAXIMUM_PLUGIN_SCAN_DEPTH) {
      return
    }
    let resolved: string
    try {
      resolved = await realpath(directory)
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') {
        incompletePaths.add(directory)
      }
      return
    }
    if (visited.has(resolved)) {
      return
    }
    visited.add(resolved)

    let handle: Awaited<ReturnType<typeof opendir>>
    try {
      handle = await opendir(directory)
    } catch {
      incompletePaths.add(directory)
      return
    }
    const entries: Dirent[] = []
    try {
      for (;;) {
        const entry = await handle.read()
        if (!entry) {
          break
        }
        entryCount += 1
        if (entryCount > MAXIMUM_PLUGIN_SCAN_ENTRIES) {
          limitReached = true
          incompletePaths.add(rootPath)
          break
        }
        entries.push(entry)
      }
    } catch {
      incompletePaths.add(directory)
    } finally {
      await handle.close().catch(() => undefined)
    }

    for (const entry of entries) {
      if (limitReached) {
        return
      }
      const entryPath = join(directory, entry.name)
      let directoryEntry = entry.isDirectory()
      if (entry.isSymbolicLink()) {
        try {
          directoryEntry = (await stat(entryPath)).isDirectory()
        } catch {
          if (knownNames.has(entry.name)) {
            candidates.push({ name: entry.name, path: entryPath })
          }
          continue
        }
      }
      if (!directoryEntry) {
        continue
      }
      if (knownNames.has(entry.name)) {
        candidates.push({ name: entry.name, path: entryPath })
        continue
      }
      await visit(entryPath, depth + 1)
    }
  }

  await visit(rootPath, 0)
  return { candidates, incompletePaths: [...incompletePaths] }
}

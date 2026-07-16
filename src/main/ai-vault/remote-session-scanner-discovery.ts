import { extname } from 'node:path'
import type { AiVaultAgent, AiVaultScanIssue } from '../../shared/ai-vault-types'
import type { ExecutionHostId } from '../../shared/execution-host'
import type { FileStat, IFilesystemProvider } from '../providers/types'
import type { RemoteHostPlatform } from '../ssh/ssh-remote-platform'
import { joinRemotePath } from '../ssh/ssh-remote-platform'
import { partitionSubagentTranscriptPaths } from './session-scanner-subagent-transcripts'
import type { FileWithMtime } from './session-scanner-types'
import { errorMessage } from './session-scanner-values'
import type {
  RemoteScannerContext,
  RemoteSessionCandidate,
  RemoteSessionSource
} from './remote-session-scanner-types'

const REMOTE_DISCOVERY_CONCURRENCY = 8

export async function discoverRemoteSourceCandidates(args: {
  source: RemoteSessionSource
  context: RemoteScannerContext
  issues: AiVaultScanIssue[]
}): Promise<RemoteSessionCandidate[]> {
  const walked = args.source.fixedChildFileSegments
    ? await listRemoteFixedChildFiles(args.source, args.context.provider, args.context.hostPlatform)
    : await walkRemoteSessionFiles(args.source, args.context.provider, args.context.hostPlatform)
  const partition = args.source.collectSubagentSiblingCounts
    ? partitionSubagentTranscriptPaths(walked)
    : null
  const paths = partition ? partition.sessionFilePaths : walked
  const files = await mapDiscoveryConcurrently(paths, (path) =>
    statRemoteFile(
      args.context.provider,
      path,
      args.source.agent,
      args.context.executionHostId,
      args.issues,
      Boolean(args.source.fixedChildFileSegments)
    )
  )
  return files
    .filter((file): file is FileWithMtime => Boolean(file))
    .map((file) => ({
      source: args.source,
      file,
      subagentTranscriptCount: partition?.subagentTranscriptCounts.get(file.path) ?? 0
    }))
}

async function listRemoteFixedChildFiles(
  source: RemoteSessionSource,
  provider: IFilesystemProvider,
  hostPlatform: RemoteHostPlatform
): Promise<string[]> {
  let entries
  try {
    entries = await provider.readDir(source.rootDir)
  } catch {
    return []
  }
  const segments = source.fixedChildFileSegments ?? []
  // Why: Antigravity's transcript path is fixed. Constructing it avoids three
  // serialized SSH readDir round trips for every conversation directory.
  return entries
    .filter((entry) => entry.isDirectory && !entry.isSymlink)
    .map((entry) => joinRemotePath(hostPlatform, source.rootDir, entry.name, ...segments))
    .filter((path) => source.filePredicate?.(path) ?? true)
}

async function walkRemoteSessionFiles(
  source: RemoteSessionSource,
  provider: IFilesystemProvider,
  hostPlatform: RemoteHostPlatform,
  dirPath = source.rootDir,
  depth = 0
): Promise<string[]> {
  let entries
  try {
    entries = await provider.readDir(dirPath)
  } catch {
    return []
  }

  const extensions = new Set(source.extensions)
  const files: string[] = []
  for (const entry of entries) {
    const fullPath = joinRemotePath(hostPlatform, dirPath, entry.name)
    if (
      entry.isDirectory &&
      !entry.isSymlink &&
      (source.directoryPredicate?.(entry.name, depth) ?? true)
    ) {
      files.push(
        ...(await walkRemoteSessionFiles(source, provider, hostPlatform, fullPath, depth + 1))
      )
      continue
    }
    if (
      !entry.isSymlink &&
      extensions.has(extname(entry.name).toLowerCase()) &&
      (source.filePredicate?.(fullPath) ?? true)
    ) {
      files.push(fullPath)
    }
  }
  return files
}

async function statRemoteFile(
  provider: IFilesystemProvider,
  path: string,
  agent: AiVaultAgent,
  executionHostId: ExecutionHostId,
  issues: AiVaultScanIssue[],
  missingIsExpected: boolean
): Promise<FileWithMtime | null> {
  try {
    const stat = await provider.stat(path)
    const mtimeMs = remoteStatMtimeMs(stat)
    return { path, mtimeMs, modifiedAt: new Date(mtimeMs).toISOString() }
  } catch (err) {
    if (!missingIsExpected || !isMissingRemoteFileError(err)) {
      issues.push({ executionHostId, agent, path, message: errorMessage(err) })
    }
    return null
  }
}

function isMissingRemoteFileError(err: unknown): boolean {
  const code =
    err && typeof err === 'object' && 'code' in err && typeof err.code === 'string'
      ? err.code
      : null
  if (code === 'ENOENT' || code === 'ENOTDIR') {
    return true
  }
  // Relay/provider boundaries can preserve only the underlying Node error text.
  return /(?:^|[\s:])(ENOENT|ENOTDIR)(?=[\s:]|$)/.test(errorMessage(err))
}

function remoteStatMtimeMs(stat: FileStat): number {
  if (typeof stat.mtimeMs === 'number' && Number.isFinite(stat.mtimeMs)) {
    return stat.mtimeMs
  }
  return stat.mtime > 10_000_000_000 ? stat.mtime : stat.mtime * 1000
}

async function mapDiscoveryConcurrently<T, U>(
  items: readonly T[],
  mapper: (item: T) => Promise<U>
): Promise<U[]> {
  const results: U[] = []
  for (let index = 0; index < items.length; index += REMOTE_DISCOVERY_CONCURRENCY) {
    const batch = items.slice(index, index + REMOTE_DISCOVERY_CONCURRENCY)
    results.push(...(await Promise.all(batch.map(mapper))))
  }
  return results
}

import { execFile } from 'node:child_process'
import { open } from 'node:fs/promises'
import { promisify } from 'node:util'
import {
  probeDarwinProcessIncarnations,
  probeLinuxProcessIncarnations
} from './daemon-session-process-incarnation-posix'
import { probeWindowsProcessIncarnations } from './daemon-session-process-incarnation-windows'

const execFileAsync = promisify(execFile)
const MAX_PID = 0xffff_ffff
const FILE_READ_CHUNK_BYTES = 4 * 1024

export type ProcessIncarnationObservation =
  | { pid: number; state: 'observed'; token: string }
  | { pid: number; state: 'not-observed' | 'ambiguous' | 'unknown' }

export type ProcessIncarnationProbeResult = {
  status: 'success' | 'failure'
  reason: 'none' | 'invalid-input' | 'unsupported-platform' | 'probe-failed'
  observations: ProcessIncarnationObservation[]
  externalProcessCount: number
}

export type ProcessIncarnationCommandOptions = {
  encoding: 'utf8'
  timeout: number
  maxBuffer: number
  windowsHide: boolean
  env?: NodeJS.ProcessEnv
}

export type ProcessIncarnationProbeDependencies = {
  platform: NodeJS.Platform
  now: () => number
  readBoundedFile: (path: string, maxBytes: number) => Promise<string>
  runCommand: (
    executable: string,
    args: string[],
    options: ProcessIncarnationCommandOptions
  ) => Promise<{ stdout: string }>
}

export type ProcessIncarnationResolver = {
  probe: (pids: readonly number[]) => Promise<ProcessIncarnationProbeResult>
  probeFreshAfterFence: (pids: readonly number[]) => Promise<ProcessIncarnationProbeResult>
}

const defaultDependencies: ProcessIncarnationProbeDependencies = {
  platform: process.platform,
  now: Date.now,
  readBoundedFile: async (path, maxBytes) => {
    const handle = await open(path, 'r')
    try {
      const chunks: Buffer[] = []
      let totalBytes = 0
      while (totalBytes <= maxBytes) {
        const remaining = maxBytes + 1 - totalBytes
        const buffer = Buffer.alloc(Math.min(FILE_READ_CHUNK_BYTES, remaining))
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, totalBytes)
        if (bytesRead === 0) {
          return Buffer.concat(chunks, totalBytes).toString('utf8')
        }
        chunks.push(buffer.subarray(0, bytesRead))
        totalBytes += bytesRead
      }
      throw new Error('process identity file exceeded byte limit')
    } finally {
      await handle.close()
    }
  },
  runCommand: async (executable, args, options) => {
    const { stdout } = await execFileAsync(executable, args, options)
    return { stdout: String(stdout) }
  }
}

export function createProcessIncarnationResolver(
  dependencies: ProcessIncarnationProbeDependencies = defaultDependencies
): ProcessIncarnationResolver {
  const probe = async (pids: readonly number[]): Promise<ProcessIncarnationProbeResult> => {
    const normalized = normalizePids(pids)
    if (normalized === null) {
      return failedInputResult(pids)
    }
    if (normalized.length === 0) {
      return successfulEmptyResult()
    }
    if (dependencies.platform === 'darwin') {
      return probeDarwinProcessIncarnations(normalized, dependencies)
    }
    if (dependencies.platform === 'linux') {
      return probeLinuxProcessIncarnations(normalized, dependencies)
    }
    if (dependencies.platform === 'win32') {
      return probeWindowsProcessIncarnations(normalized, dependencies)
    }
    return {
      status: 'failure',
      reason: 'unsupported-platform',
      observations: normalized.map(unknownObservation),
      externalProcessCount: 0
    }
  }

  return {
    probe,
    // Why: destructive revalidation must begin after the candidate fence; no
    // pre-fence snapshot or in-flight promise is cached by this resolver.
    probeFreshAfterFence: (pids) => probe(pids)
  }
}

export const processIncarnationResolver = createProcessIncarnationResolver()

function normalizePids(pids: readonly number[]): number[] | null {
  const unique = new Set<number>()
  for (const pid of pids) {
    if (!Number.isSafeInteger(pid) || pid <= 0 || pid > MAX_PID) {
      return null
    }
    unique.add(pid)
  }
  return [...unique]
}

function failedInputResult(pids: readonly number[]): ProcessIncarnationProbeResult {
  const valid = pids.filter(
    (pid, index) =>
      Number.isSafeInteger(pid) && pid > 0 && pid <= MAX_PID && pids.indexOf(pid) === index
  )
  return {
    status: 'failure',
    reason: 'invalid-input',
    observations: valid.map(unknownObservation),
    externalProcessCount: 0
  }
}

function successfulEmptyResult(): ProcessIncarnationProbeResult {
  return { status: 'success', reason: 'none', observations: [], externalProcessCount: 0 }
}

function unknownObservation(pid: number): ProcessIncarnationObservation {
  return { pid, state: 'unknown' }
}

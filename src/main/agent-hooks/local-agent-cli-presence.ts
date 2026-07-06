import { access, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import type { AgentHookTarget } from '../../shared/agent-hook-types'
import type { ManagedAgentHookTarget } from '../../shared/managed-agent-hook-targets'
import {
  extractExecutableToken,
  hasPathSeparatorToken,
  isSafeExecutableBasename
} from '../../shared/managed-agent-command-token'
import type { GlobalSettings } from '../../shared/types'
import { hydrateShellPath, mergePathSegments } from '../startup/hydrate-shell-path'

export type LocalCliPresenceState = 'found' | 'missing' | 'unknown'

export type LocalCliPresence = {
  state: LocalCliPresenceState
}

type FileProbe = {
  isExecutableFile: (filePath: string) => Promise<boolean>
}

type HydrationResult =
  | { ok: true; segments: string[] }
  | { ok: false; segments: []; failureReason?: string }

type DetectOptions = {
  pathEnv?: string
  platform?: NodeJS.Platform
  pathDelimiter?: string
  pathExt?: string
  fileProbe?: FileProbe
  hydratePath?: () => Promise<HydrationResult>
  shouldHydrateShellPath?: boolean
  homeDir?: string
}

export type LocalCliPresenceByAgent = Partial<Record<AgentHookTarget, LocalCliPresence>>

const DEFAULT_WINDOWS_EXTENSIONS = ['.COM', '.EXE', '.BAT', '.CMD']

async function isExecutableFile(filePath: string, platform: NodeJS.Platform): Promise<boolean> {
  try {
    const fileStat = await stat(filePath)
    if (!fileStat.isFile()) {
      return false
    }
    if (platform === 'win32') {
      return true
    }
    await access(filePath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function pathEntries(pathEnv: string, delimiter: string): string[] {
  return [...new Set(pathEnv.split(delimiter).filter(Boolean))]
}

function windowsPathExts(value: string | undefined): string[] {
  const source = value && value.length > 0 ? value : DEFAULT_WINDOWS_EXTENSIONS.join(';')
  return [
    ...new Set(
      source
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => (part.startsWith('.') ? part : `.${part}`))
        .map((part) => part.toUpperCase())
    )
  ]
}

function candidateFileNames(
  candidate: string,
  platform: NodeJS.Platform,
  pathExt?: string
): string[] {
  if (platform !== 'win32') {
    return [candidate]
  }
  const ext = path.extname(candidate)
  if (ext) {
    return [candidate]
  }
  return windowsPathExts(pathExt).map((suffix) => `${candidate}${suffix}`)
}

function overrideTokenForAgent(
  settings: Pick<GlobalSettings, 'agentCmdOverrides'> | null | undefined,
  target: ManagedAgentHookTarget,
  platform: NodeJS.Platform
): string | null {
  return extractExecutableToken(settings?.agentCmdOverrides?.[target.tuiAgent], { platform })
}

function expandHomePathToken(token: string, platform: NodeJS.Platform, homeDir: string): string {
  if (token === '~') {
    return homeDir
  }
  if (token.startsWith('~/')) {
    return path.join(homeDir, token.slice(2))
  }
  if (platform === 'win32' && token.startsWith('~\\')) {
    return path.join(homeDir, token.slice(2))
  }
  return token
}

async function probePathCandidate(
  candidate: string,
  dirs: readonly string[],
  platform: NodeJS.Platform,
  fileProbe: FileProbe,
  pathExt?: string
): Promise<boolean> {
  if (!isSafeExecutableBasename(candidate)) {
    return false
  }
  for (const dir of dirs) {
    for (const fileName of candidateFileNames(candidate, platform, pathExt)) {
      if (await fileProbe.isExecutableFile(path.join(dir, fileName))) {
        return true
      }
    }
  }
  return false
}

function isPlatformAbsolutePath(candidate: string, platform: NodeJS.Platform): boolean {
  return platform === 'win32' ? path.win32.isAbsolute(candidate) : path.posix.isAbsolute(candidate)
}

async function maybeHydrateShellPath(options: DetectOptions): Promise<void> {
  if (!options.shouldHydrateShellPath) {
    return
  }
  try {
    const result = await (options.hydratePath ?? hydrateShellPath)()
    if (result.ok) {
      mergePathSegments(result.segments)
    }
  } catch {
    // Detection remains fail-open for app startup but fail-closed for mutation.
  }
}

export async function detectLocalManagedAgentCliPresence(
  targets: readonly ManagedAgentHookTarget[],
  settings: Pick<GlobalSettings, 'agentCmdOverrides'> | null | undefined,
  options: DetectOptions = {}
): Promise<LocalCliPresenceByAgent> {
  await maybeHydrateShellPath(options)
  const platform = options.platform ?? process.platform
  const delimiter = options.pathDelimiter ?? path.delimiter
  const dirs = pathEntries(options.pathEnv ?? process.env.PATH ?? '', delimiter)
  const homeDir = options.homeDir ?? homedir()
  const fileProbe = options.fileProbe ?? {
    isExecutableFile: (filePath: string) => isExecutableFile(filePath, platform)
  }
  const defaultCandidates = new Set<string>()
  for (const target of targets) {
    for (const candidate of target.executableCandidates) {
      if (!hasPathSeparatorToken(candidate)) {
        defaultCandidates.add(candidate)
      }
    }
    const overrideToken = overrideTokenForAgent(settings, target, platform)
    if (overrideToken && !hasPathSeparatorToken(overrideToken)) {
      defaultCandidates.add(overrideToken)
    }
  }
  const foundCandidates = new Set<string>()
  for (const candidate of defaultCandidates) {
    if (await probePathCandidate(candidate, dirs, platform, fileProbe, options.pathExt)) {
      foundCandidates.add(candidate)
    }
  }
  const result: LocalCliPresenceByAgent = {}
  for (const target of targets) {
    const overrideToken = overrideTokenForAgent(settings, target, platform)
    if (overrideToken && hasPathSeparatorToken(overrideToken)) {
      const expandedOverride = expandHomePathToken(overrideToken, platform, homeDir)
      // Why: a relative override resolves against whichever CWD the agent is
      // later launched from, so probing it against the main process's CWD
      // would report presence for an unrelated directory.
      if (!isPlatformAbsolutePath(expandedOverride, platform)) {
        result[target.agent] = { state: 'unknown' }
        continue
      }
      result[target.agent] = (await fileProbe.isExecutableFile(expandedOverride))
        ? { state: 'found' }
        : { state: 'missing' }
      continue
    }
    const candidates = [...target.executableCandidates, ...(overrideToken ? [overrideToken] : [])]
    result[target.agent] = candidates.some((candidate) => foundCandidates.has(candidate))
      ? { state: 'found' }
      : { state: 'missing' }
  }
  return result
}

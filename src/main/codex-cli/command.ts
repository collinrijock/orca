import { accessSync, constants, existsSync, readdirSync, statSync } from 'node:fs'
import { access, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'

type ResolveCommandOptions = {
  pathEnv?: string | null
  platform?: NodeJS.Platform
  homePath?: string
}

function getExecutableNames(platform: NodeJS.Platform, commandName: string): string[] {
  if (platform === 'win32') {
    return [
      `${commandName}.cmd`,
      `${commandName}.exe`,
      `${commandName}.bat`,
      `${commandName}.com`,
      commandName
    ]
  }

  return [commandName]
}

function splitPath(pathEnv: string | null | undefined): string[] {
  if (!pathEnv) {
    return []
  }

  return pathEnv
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function parseVersionSegment(raw: string): number[] {
  return raw
    .replace(/^v/i, '')
    .split('.')
    .map((segment) => Number.parseInt(segment, 10))
    .map((segment) => (Number.isFinite(segment) ? segment : 0))
}

function compareVersionDesc(left: string, right: string): number {
  const leftParts = parseVersionSegment(left)
  const rightParts = parseVersionSegment(right)
  const length = Math.max(leftParts.length, rightParts.length)

  for (let index = 0; index < length; index += 1) {
    const delta = (rightParts[index] ?? 0) - (leftParts[index] ?? 0)
    if (delta !== 0) {
      return delta
    }
  }

  return right.localeCompare(left)
}

function findFirstExecutable(
  platform: NodeJS.Platform,
  directories: string[],
  executableNames: string[]
): string | null {
  for (const directory of directories) {
    for (const executableName of executableNames) {
      const candidate = join(directory, executableName)
      if (isRunnableCommand(platform, candidate)) {
        return candidate
      }
    }
  }

  return null
}

// Why: bulk resolution runs on the Electron main process at startup, where a
// slow PATH entry (dead network mount, FUSE dir) must stall this promise, not
// the event loop — so this variant is async end to end.
async function resolveCommandsInDirectories(
  platform: NodeJS.Platform,
  directories: readonly string[],
  executableNamesByCommand: ReadonlyMap<string, readonly string[]>,
  resolved: Map<string, string>
): Promise<void> {
  for (const directory of directories) {
    let entries: string[] | null
    try {
      entries = await readdir(directory)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        continue
      }
      // Why: search-only directories (x without r) fail readdir but still
      // resolve by direct candidate probing, like the per-command resolver.
      entries = null
    }
    // Why: Windows and default macOS volumes match executables
    // case-insensitively, and the direct stat probing this index replaced
    // inherited that from the filesystem. On darwin the candidate keeps the
    // probe's name so the stat below still rejects it on a case-sensitive
    // volume.
    const caseInsensitiveLookup = platform === 'win32' || platform === 'darwin'
    const entryByLookupName = entries
      ? new Map(
          entries.map((entry) => [caseInsensitiveLookup ? entry.toLowerCase() : entry, entry])
        )
      : null
    for (const [commandName, executableNames] of executableNamesByCommand) {
      if (resolved.has(commandName)) {
        continue
      }
      for (const executableName of executableNames) {
        let candidate: string
        if (entryByLookupName) {
          const entry = entryByLookupName.get(
            caseInsensitiveLookup ? executableName.toLowerCase() : executableName
          )
          if (!entry) {
            continue
          }
          candidate = join(directory, platform === 'win32' ? entry : executableName)
        } else {
          candidate = join(directory, executableName)
        }
        if (await isRunnableCommandAsync(platform, candidate)) {
          resolved.set(commandName, candidate)
          break
        }
      }
    }
  }
}

function isRunnableCommand(platform: NodeJS.Platform, candidate: string): boolean {
  try {
    const stats = statSync(candidate)
    if (!stats.isFile()) {
      return false
    }
    if (platform === 'win32') {
      return true
    }
    // Why: GUI fallback probing should skip placeholders/directories so spawn
    // can continue to a runnable CLI instead of failing later with EACCES/EISDIR.
    accessSync(candidate, constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function isRunnableCommandAsync(
  platform: NodeJS.Platform,
  candidate: string
): Promise<boolean> {
  try {
    const stats = await stat(candidate)
    if (!stats.isFile()) {
      return false
    }
    if (platform === 'win32') {
      return true
    }
    await access(candidate, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function getBaseVersionManagerDirectories(platform: NodeJS.Platform, homePath: string): string[] {
  const directories = [
    join(homePath, '.volta', 'bin'),
    join(homePath, '.asdf', 'shims'),
    join(homePath, '.fnm', 'aliases', 'default', 'bin'),
    // Why: mise (formerly rtx) exposes managed tool binaries via a shims
    // directory, similar to asdf. Without this, users who installed node
    // or CLI tools through mise can't be found by the fallback probe.
    join(homePath, '.local', 'share', 'mise', 'shims')
  ]

  if (platform === 'win32') {
    // Why: Anthropic's native Windows installer places claude.exe here, and
    // GUI-launched Orca may not inherit the user's PATH entry for it.
    directories.push(join(homePath, '.local', 'bin'))
    directories.push(join(homePath, 'AppData', 'Roaming', 'npm'))
    directories.push(join(homePath, 'AppData', 'Local', 'pnpm'))
    directories.push(join(homePath, 'AppData', 'Local', 'Yarn', 'bin'))
  } else {
    directories.push(join(homePath, '.local', 'bin'))
    // Why: pnpm uses platform-specific global bin directories that differ from
    // npm's ~/.local/bin. macOS follows the ~/Library convention while Linux
    // uses the XDG-compatible ~/.local/share path. Without these, users who
    // installed via `pnpm add -g` can't be found by the fallback probe.
    if (platform === 'darwin') {
      directories.push(join(homePath, 'Library', 'pnpm'))
    } else {
      directories.push(join(homePath, '.local', 'share', 'pnpm'))
    }
    directories.push(join(homePath, '.yarn', 'bin'))
  }

  // Why: bun uses ~/.bun/bin on all platforms for globally installed packages.
  directories.push(join(homePath, '.bun', 'bin'))

  return directories
}

function getNvmVersionDirectories(homePath: string): string[] {
  const nvmVersionsDir = join(homePath, '.nvm', 'versions', 'node')
  if (!existsSync(nvmVersionsDir)) {
    return []
  }

  return readdirSync(nvmVersionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(compareVersionDesc)
    .map((entry) => join(nvmVersionsDir, entry, 'bin'))
}

function getVersionManagerDirectories(
  platform: NodeJS.Platform,
  homePath: string,
  executableNames: string[]
): string[] {
  const directories = getBaseVersionManagerDirectories(platform, homePath)

  // Why: GUI-launched Electron apps do not inherit shell init from nvm, so
  // command resolution probes the newest installed Node versions explicitly.
  const firstNvmMatch = findFirstExecutable(
    platform,
    getNvmVersionDirectories(homePath),
    executableNames
  )
  if (firstNvmMatch) {
    directories.unshift(dirname(firstNvmMatch))
  }

  return directories
}

export function resolveCliCommand(
  commandName: string,
  options: ResolveCommandOptions = {}
): string {
  const platform = options.platform ?? process.platform
  const executableNames = getExecutableNames(platform, commandName)
  const pathEnv = options.pathEnv ?? process.env.PATH ?? process.env.Path ?? null
  const pathCandidate = findFirstExecutable(platform, splitPath(pathEnv), executableNames)
  if (pathCandidate) {
    return pathCandidate
  }

  const homePath = options.homePath ?? homedir()
  const versionManagerCandidate = findFirstExecutable(
    platform,
    getVersionManagerDirectories(platform, homePath, executableNames),
    executableNames
  )
  return versionManagerCandidate ?? commandName
}

export async function resolveCliCommands(
  commandNames: readonly string[],
  options: ResolveCommandOptions = {}
): Promise<Map<string, string>> {
  const platform = options.platform ?? process.platform
  const pathEnv = options.pathEnv ?? process.env.PATH ?? process.env.Path ?? null
  const pathDirectories = splitPath(pathEnv)
  const homePath = options.homePath ?? homedir()
  // Why: agent detection probes many CLIs at once; compute expensive install
  // directories, especially nvm versions, once per detection pass.
  const installDirectories = [
    ...getNvmVersionDirectories(homePath),
    ...getBaseVersionManagerDirectories(platform, homePath)
  ]
  const commandNamesUnique = [...new Set(commandNames)]
  const executableNamesByCommand = new Map(
    commandNamesUnique.map((commandName) => [
      commandName,
      getExecutableNames(platform, commandName)
    ])
  )
  const resolved = new Map<string, string>()

  // Why: agent detection resolves many commands at once. Reading each PATH
  // directory once avoids hundreds of failed stat calls at startup.
  await resolveCommandsInDirectories(platform, pathDirectories, executableNamesByCommand, resolved)
  await resolveCommandsInDirectories(
    platform,
    installDirectories,
    executableNamesByCommand,
    resolved
  )
  for (const commandName of commandNamesUnique) {
    if (!resolved.has(commandName)) {
      resolved.set(commandName, commandName)
    }
  }

  return resolved
}

export function resolveCodexCommand(options: ResolveCommandOptions = {}): string {
  return resolveCliCommand('codex', options)
}

export function resolveClaudeCommand(options: ResolveCommandOptions = {}): string {
  return resolveCliCommand('claude', options)
}

// Why: GUI-launched Electron apps inherit a minimal PATH that excludes Node
// version manager directories. CLI tools like codex/claude are Node scripts
// with #!/usr/bin/env node shebangs — they need `node` in PATH to execute,
// not just to be *found*. This function returns the version manager bin paths
// so the caller can augment process.env.PATH at startup.
export function getVersionManagerBinPaths(options: ResolveCommandOptions = {}): string[] {
  const platform = options.platform ?? process.platform
  const homePath = options.homePath ?? homedir()
  const nodeNames = getExecutableNames(platform, 'node')
  return getVersionManagerDirectories(platform, homePath, nodeNames)
}

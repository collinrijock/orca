import { existsSync } from 'fs'
import { userInfo } from 'os'
import { delimiter, join, posix } from 'path'

export const WINDOWS_BATCH_UNSAFE_ARGUMENTS_ERROR = 'UNSAFE_WINDOWS_BATCH_ARGUMENTS'

export type SpawnCommand = { spawnCmd: string; spawnArgs: string[] }

type SpawnPlan = SpawnCommand & { shellFallback?: SpawnCommand }

function getCmdExePath(): string {
  return process.env.ComSpec || `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\cmd.exe`
}

function isWindowsBatchScript(commandPath: string): boolean {
  return process.platform === 'win32' && /\.(cmd|bat)$/i.test(commandPath)
}

function hasUnsafeWindowsBatchSyntax(value: string): boolean {
  return /[&|<>^"%!\r\n]/.test(value)
}

function quoteWindowsBatchToken(value: string): string {
  if (hasUnsafeWindowsBatchSyntax(value)) {
    throw new Error(WINDOWS_BATCH_UNSAFE_ARGUMENTS_ERROR)
  }
  return `"${value}"`
}

function resolveWindowsCommand(binary: string, env: NodeJS.ProcessEnv): string {
  if (process.platform !== 'win32') {
    return binary
  }
  if (/[\\/]/.test(binary) || /\.[a-z0-9]+$/i.test(binary)) {
    return binary
  }

  const pathEnv = env.PATH ?? env.Path
  if (!pathEnv) {
    return binary
  }
  const names = [`${binary}.cmd`, `${binary}.exe`, `${binary}.bat`, binary]
  for (const directory of pathEnv.split(delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = join(directory, name)
      if (existsSync(candidate)) {
        return candidate
      }
    }
  }
  return binary
}

function getWindowsSafeSpawn(binary: string, args: string[], env: NodeJS.ProcessEnv): SpawnCommand {
  const resolvedBinary = resolveWindowsCommand(binary, env)
  if (!isWindowsBatchScript(resolvedBinary)) {
    return { spawnCmd: resolvedBinary, spawnArgs: args }
  }
  const commandLine = [resolvedBinary, ...args].map(quoteWindowsBatchToken).join(' ')
  return { spawnCmd: getCmdExePath(), spawnArgs: ['/d', '/s', '/c', commandLine] }
}

function normalizeInteractiveShell(shell: unknown): string | null {
  if (typeof shell !== 'string') {
    return null
  }
  if (!shell || !posix.isAbsolute(shell)) {
    return null
  }
  const shellName = posix.basename(shell).toLowerCase()
  return shellName === 'bash' || shellName === 'zsh' ? shell : null
}

function getAccountLoginShell(): string | null {
  try {
    return normalizeInteractiveShell(userInfo().shell)
  } catch {
    return null
  }
}

function resolveRequestedInteractiveShell(env: NodeJS.ProcessEnv): string | null {
  const envShell = typeof env.SHELL === 'string' ? env.SHELL : ''
  if (envShell) {
    return normalizeInteractiveShell(envShell)
  }
  return getAccountLoginShell()
}

function buildInteractiveShellFallback(
  binary: string,
  args: string[],
  env: NodeJS.ProcessEnv
): SpawnCommand | null {
  if (binary.includes('/')) {
    return null
  }
  const shell = resolveRequestedInteractiveShell(env)
  if (!shell) {
    return null
  }
  // Why: SSH relay processes are launched by a non-interactive SSH command,
  // whose PATH often lacks nvm/fnm/Homebrew agent installs. Use the user's
  // explicit bash/zsh only as an ENOENT fallback so normal PATH hits stay fast.
  return {
    spawnCmd: shell,
    spawnArgs: ['-ilc', 'exec "$@"', '_', binary, ...args]
  }
}

export function getSpawnPlan(
  binary: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  useShell: boolean
): SpawnPlan {
  if (process.platform === 'win32' || !useShell) {
    return getWindowsSafeSpawn(binary, args, env)
  }
  const shellFallback = buildInteractiveShellFallback(binary, args, env)
  if (!shellFallback) {
    return { spawnCmd: binary, spawnArgs: args }
  }
  return {
    spawnCmd: binary,
    spawnArgs: args,
    shellFallback
  }
}

export function isSpawnEnoent(error: Error): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return code === 'ENOENT' || /\bENOENT\b/i.test(error.message)
}

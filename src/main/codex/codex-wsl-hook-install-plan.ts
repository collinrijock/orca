import { execFile } from 'node:child_process'
import { win32 as pathWin32 } from 'node:path'
import { parseWslUncPath } from '../../shared/wsl-paths'

export type CodexWslRuntimeHookTarget = {
  runtime?: 'host' | 'wsl'
  wslDistro?: string | null
}

export type CodexWslRuntimeHookInstallPlan = {
  configPath: string
  tomlPath: string
  scriptPath: string
  commandScriptPath: string
  trustConfigPath: string
}

export type CanonicalizeWslLinuxPath = (distro: string, linuxPath: string) => string | null

function trimTrailingSlash(value: string): string {
  return value.length > 1 ? value.replace(/\/+$/, '') : value
}

function toDefaultWslLinuxPath(windowsPath: string): string {
  const driveMatch = windowsPath.match(/^([A-Za-z]):[/\\](.*)$/)
  if (!driveMatch) {
    return windowsPath
  }
  return `/mnt/${driveMatch[1].toLowerCase()}/${driveMatch[2].replace(/\\/g, '/')}`
}

const WSL_CANONICALIZE_TIMEOUT_MS = 5000

// Why: `readlink -f` over wsl.exe stalls up to the timeout on a cold or wedged
// distro. Running it synchronously (execFileSync) on the Electron main process
// froze the UI on every Codex WSL launch, so resolve it off-thread and return
// the cached result synchronously (null until the first resolution lands).
const canonicalWslPathCache = new Map<string, string>()
const inFlightWslCanonicalizations = new Set<string>()

function wslCanonicalizeCacheKey(distro: string, linuxPath: string): string {
  return `${distro}\x00${linuxPath}`
}

function canonicalizeWslLinuxPath(distro: string, linuxPath: string): string | null {
  if (process.platform !== 'win32') {
    return linuxPath
  }
  const key = wslCanonicalizeCacheKey(distro, linuxPath)
  if (!inFlightWslCanonicalizations.has(key)) {
    inFlightWslCanonicalizations.add(key)
    execFile(
      'wsl.exe',
      ['-d', distro, '--', 'readlink', '-f', '--', linuxPath],
      { encoding: 'utf-8', timeout: WSL_CANONICALIZE_TIMEOUT_MS, windowsHide: true },
      (error, stdout) => {
        inFlightWslCanonicalizations.delete(key)
        const canonicalPath = stdout.trim()
        if (!error && canonicalPath.startsWith('/')) {
          canonicalWslPathCache.set(key, canonicalPath)
        }
      }
    )
  }
  // Why: return the cached canonical path (or null on the first launch, which
  // falls back to the logical path) so plan building stays synchronous without
  // blocking the main thread on the wsl.exe subprocess.
  return canonicalWslPathCache.get(key) ?? null
}

export function createCodexWslRuntimeHookInstallPlan(
  runtimeHomePath: string | null | undefined,
  target?: CodexWslRuntimeHookTarget,
  canonicalize: CanonicalizeWslLinuxPath = canonicalizeWslLinuxPath
): CodexWslRuntimeHookInstallPlan | null {
  if (!runtimeHomePath) {
    return null
  }

  const wslInfo = parseWslUncPath(runtimeHomePath)
  if (!wslInfo && target?.runtime !== 'wsl') {
    return null
  }
  const distro = wslInfo?.distro || (target?.runtime === 'wsl' ? target.wslDistro?.trim() : null)
  if (!distro) {
    return null
  }

  const logicalLinuxRuntimeHome = wslInfo?.linuxPath ?? toDefaultWslLinuxPath(runtimeHomePath)
  if (!logicalLinuxRuntimeHome.startsWith('/')) {
    return null
  }
  // Why: Codex canonicalizes hook sources inside WSL; resolving there keeps
  // trust keys valid when HOME or the runtime directory crosses a symlink.
  const linuxRuntimeHome = trimTrailingSlash(
    canonicalize(distro, logicalLinuxRuntimeHome) ?? logicalLinuxRuntimeHome
  )

  return {
    configPath: pathWin32.join(runtimeHomePath, 'hooks.json'),
    tomlPath: pathWin32.join(runtimeHomePath, 'config.toml'),
    scriptPath: pathWin32.join(runtimeHomePath, '.orca', 'agent-hooks', 'codex-hook.sh'),
    commandScriptPath: `${linuxRuntimeHome}/.orca/agent-hooks/codex-hook.sh`,
    trustConfigPath: `${linuxRuntimeHome}/hooks.json`
  }
}

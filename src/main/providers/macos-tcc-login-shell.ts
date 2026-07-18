import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { userInfo } from 'node:os'

const MACOS_LOGIN_PATH = '/usr/bin/login'
const MACOS_ENV_PATH = '/usr/bin/env'
const MACOS_PRINTF_PATH = '/usr/bin/printf'
const LOGIN_PREFLIGHT_TIMEOUT_MS = 500
const LOGIN_PREFLIGHT_MARKER = 'ORCA_LOGIN_PREFLIGHT_OK'

/**
 * Env escape hatch to force the plain (unwrapped) spawn. Set to `1`/`true` if a
 * user's environment misbehaves under login(1); terminals fall back to today's
 * direct-spawn behavior.
 */
const DISABLE_ENV_VAR = 'ORCA_DISABLE_MACOS_LOGIN_SHELL'

let cachedLoginPreflightResult: boolean | null = null

function isDisabledByEnv(): boolean {
  const value = process.env[DISABLE_ENV_VAR]
  return value === '1' || value === 'true'
}

function loginPreflightSucceeds(username: string): boolean {
  if (cachedLoginPreflightResult !== null) {
    return cachedLoginPreflightResult
  }

  try {
    // Why: login(1) still runs PAM account/session policy under -f. Probe it
    // without a TTY so a rejection cannot strand the real PTY at `login:`.
    const result = spawnSync(
      MACOS_LOGIN_PATH,
      ['-flpq', username, MACOS_PRINTF_PATH, LOGIN_PREFLIGHT_MARKER],
      {
        encoding: 'utf8',
        // Why: this runs once on the Electron main thread; bound UI impact and
        // use SIGKILL because spawnSync waits past timeouts when PAM ignores SIGTERM.
        killSignal: 'SIGKILL',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: LOGIN_PREFLIGHT_TIMEOUT_MS
      }
    )
    // login(1) can return zero after an EOF-driven failed prompt, so only the
    // requested child program's output plus a clean exit proves PAM accepted it.
    cachedLoginPreflightResult =
      result.error === undefined && result.status === 0 && result.stdout === LOGIN_PREFLIGHT_MARKER
  } catch {
    cachedLoginPreflightResult = false
  }

  if (!cachedLoginPreflightResult) {
    console.warn('[pty] macOS login(1) preflight failed; spawning shells directly')
  }
  return cachedLoginPreflightResult
}

export function resetMacosLoginShellPreflightForTests(): void {
  cachedLoginPreflightResult = null
}

/**
 * Wrap a macOS shell spawn in `/usr/bin/login -flpq <user> …` so terminal children
 * get their own TCC identity instead of collapsing into Orca's bundle id — signed
 * CLIs like `op` otherwise re-prompt every launch because tccd attributes the grant
 * to Orca and never persists it (#6996). This mirrors how Terminal.app spawns shells.
 *
 * Why the env(1) interposition: login(1) overwrites SHELL from the account DB even
 * under -p, so `/usr/bin/env SHELL=<shell>` re-asserts the shell Orca actually runs
 * without disturbing login's attribution (skipped when the shell path contains `=`).
 *
 * No-op off macOS, when already wrapped, when disabled via {@link DISABLE_ENV_VAR},
 * or when the login(1) PAM preflight rejects this process's user.
 */
export function wrapShellSpawnForMacosTccAttribution(
  file: string,
  args: string[],
  env?: Record<string, string | undefined>
): { file: string; args: string[] } {
  if (process.platform !== 'darwin') {
    return { file, args }
  }
  if (file === MACOS_LOGIN_PATH || isDisabledByEnv()) {
    return { file, args }
  }
  if (!existsSync(MACOS_LOGIN_PATH)) {
    return { file, args }
  }

  let username: string
  try {
    username = userInfo().username
  } catch {
    return { file, args }
  }
  if (!username) {
    return { file, args }
  }
  if (!loginPreflightSucceeds(username)) {
    return { file, args }
  }

  const shellEnvValue = env?.SHELL || file
  const interposedShellEnv =
    !file.includes('=') && existsSync(MACOS_ENV_PATH)
      ? [MACOS_ENV_PATH, `SHELL=${shellEnvValue}`]
      : []

  return {
    file: MACOS_LOGIN_PATH,
    args: ['-flpq', username, ...interposedShellEnv, file, ...args]
  }
}

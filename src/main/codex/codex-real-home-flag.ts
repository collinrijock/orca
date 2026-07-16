import type { GlobalSettings } from '../../shared/types'

/**
 * Staged internal flag: route the SYSTEM-DEFAULT Codex account at the user's
 * real ~/.codex instead of Orca's managed runtime home.
 *
 * Why a flag: this moves where user Codex state lives (auth, config, sessions,
 * hooks). It is ENABLED BY DEFAULT on this RC for the staged rollout; a user can
 * still opt out by setting codexSystemDefaultRealHomeEnabled to false, which
 * stays byte-identical to today's managed-home behavior. Managed (multi-account)
 * selections are unaffected either way.
 *
 * The env override exists only so isolated dev/CDP verification can exercise
 * the ON path without a settings write; it never appears in the UI.
 */
const CODEX_REAL_HOME_ENV_FLAG = 'ORCA_CODEX_SYSTEM_DEFAULT_REAL_HOME'

export function isCodexSystemDefaultRealHomeEnabled(
  settings: Pick<GlobalSettings, 'codexSystemDefaultRealHomeEnabled'> | null | undefined
): boolean {
  const envOverride = readCodexRealHomeEnvOverride()
  if (envOverride !== null) {
    return envOverride
  }
  return settings?.codexSystemDefaultRealHomeEnabled !== false
}

function readCodexRealHomeEnvOverride(): boolean | null {
  const raw = process.env[CODEX_REAL_HOME_ENV_FLAG]
  if (raw === undefined) {
    return null
  }
  const normalized = raw.trim().toLowerCase()
  if (normalized === '1' || normalized === 'true' || normalized === 'on') {
    return true
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'off') {
    return false
  }
  return null
}

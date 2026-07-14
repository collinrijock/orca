export const TERMINAL_GIT_CREDENTIAL_GUARD_STATE_ENV = 'ORCA_TERMINAL_GIT_CREDENTIAL_GUARD_STATE'

export type GuardedScalarKey =
  | 'GIT_TERMINAL_PROMPT'
  | 'GCM_INTERACTIVE'
  | 'GIT_ASKPASS'
  | 'SSH_ASKPASS'

export type TerminalGitCredentialGuardState = {
  version: 1
  previous: Record<GuardedScalarKey, string | null> & { WSLENV: string | null }
  previousState: string | null
  previousGitConfigCount: string | null
  guardedWslEnv: string | null
  configStart: number | null
}

export function readOwnEnvValue(env: Record<string, string>, key: string): string | null {
  return Object.prototype.hasOwnProperty.call(env, key) ? env[key] : null
}

export function parseTerminalGitCredentialGuardState(
  value: string | undefined
): TerminalGitCredentialGuardState | null {
  if (!value) {
    return null
  }
  try {
    const parsed = JSON.parse(value) as Partial<TerminalGitCredentialGuardState>
    const previous = parsed.previous as Record<string, unknown> | undefined
    const hasValidPreviousValues = [
      'GIT_TERMINAL_PROMPT',
      'GCM_INTERACTIVE',
      'GIT_ASKPASS',
      'SSH_ASKPASS',
      'WSLENV'
    ].every((key) => previous?.[key] === null || typeof previous?.[key] === 'string')
    if (
      parsed.version !== 1 ||
      !previous ||
      !hasValidPreviousValues ||
      (parsed.previousState !== null && typeof parsed.previousState !== 'string') ||
      (parsed.previousGitConfigCount !== null &&
        typeof parsed.previousGitConfigCount !== 'string') ||
      (parsed.guardedWslEnv !== null && typeof parsed.guardedWslEnv !== 'string') ||
      (parsed.configStart !== null &&
        (typeof parsed.configStart !== 'number' ||
          !Number.isInteger(parsed.configStart) ||
          parsed.configStart < 0))
    ) {
      return null
    }
    return parsed as TerminalGitCredentialGuardState
  } catch {
    return null
  }
}

export function hasTerminalGitCredentialPromptGuardOwnership(env: Record<string, string>): boolean {
  return parseTerminalGitCredentialGuardState(env[TERMINAL_GIT_CREDENTIAL_GUARD_STATE_ENV]) !== null
}

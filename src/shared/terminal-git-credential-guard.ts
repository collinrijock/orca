import { recognizeAgentProcessFromCommandLine } from './agent-process-recognition'
import {
  gitCredentialPromptGuardEnv,
  readValidGitConfigEnvCount
} from './git-credential-prompt-env'
import {
  type GuardedScalarKey,
  parseTerminalGitCredentialGuardState,
  readOwnEnvValue,
  TERMINAL_GIT_CREDENTIAL_GUARD_STATE_ENV,
  type TerminalGitCredentialGuardState
} from './terminal-git-credential-guard-state'
import { restoreTerminalGitCredentialGuardWslEnv } from './terminal-git-credential-guard-wslenv'
import { addWslEnvKeys } from './wsl-env'

export {
  hasTerminalGitCredentialPromptGuardOwnership,
  TERMINAL_GIT_CREDENTIAL_GUARD_STATE_ENV
} from './terminal-git-credential-guard-state'

const GIT_CONFIG_PROTOCOL_KEY_RE = /^GIT_CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+)$/
const GUARD_CONFIG_ENTRIES = [
  ['credential.interactive', 'false'],
  ['credential.guiPrompt', 'false']
] as const

export const TERMINAL_GIT_CREDENTIAL_GUARD_POLICY_ENV =
  'ORCA_INTERNAL_TERMINAL_GIT_CREDENTIAL_GUARD_POLICY'

function hasWslEnvKeys(env: Record<string, string>, keys: readonly string[]): boolean {
  const names = new Set((env.WSLENV ?? '').split(':').filter(Boolean).map(wslenvTokenName))
  return keys.every((key) => names.has(key))
}

function hasEffectiveGuardConfigEntries(env: Record<string, string>, count: number): boolean {
  const effective = new Map<string, string>()
  for (let index = 0; index < count; index++) {
    effective.set(env[`GIT_CONFIG_KEY_${index}`], env[`GIT_CONFIG_VALUE_${index}`])
  }
  return GUARD_CONFIG_ENTRIES.every(([key, value]) => effective.get(key) === value)
}

function isGuardIntact(
  env: Record<string, string>,
  state: TerminalGitCredentialGuardState,
  platform: NodeJS.Platform
): boolean {
  if (
    env.GIT_TERMINAL_PROMPT !== '0' ||
    env.GCM_INTERACTIVE !== 'never' ||
    typeof env.GIT_ASKPASS !== 'string' ||
    typeof env.SSH_ASKPASS !== 'string'
  ) {
    return false
  }

  const requiredWslKeys = [
    TERMINAL_GIT_CREDENTIAL_GUARD_STATE_ENV,
    'GIT_TERMINAL_PROMPT',
    'GCM_INTERACTIVE'
  ]
  const count = readValidGitConfigEnvCount(env)
  // Why: scalar-only ownership is a fallback for ambiguous caller config;
  // once that protocol becomes valid, upgrade it to the full indexed guard.
  if (state.configStart === null && count !== null) {
    return false
  }
  if (state.configStart !== null) {
    if (count === null || count < state.configStart + GUARD_CONFIG_ENTRIES.length) {
      return false
    }
    for (const [offset, [key, value]] of GUARD_CONFIG_ENTRIES.entries()) {
      const index = state.configStart + offset
      if (env[`GIT_CONFIG_KEY_${index}`] !== key || env[`GIT_CONFIG_VALUE_${index}`] !== value) {
        return false
      }
    }
    if (!hasEffectiveGuardConfigEntries(env, count)) {
      return false
    }
    requiredWslKeys.push(...Object.keys(env).filter((key) => GIT_CONFIG_PROTOCOL_KEY_RE.test(key)))
  }
  return platform !== 'win32' || hasWslEnvKeys(env, requiredWslKeys)
}

/** Apply the guard once and record only the environment state Orca owns. */
export function ensureTerminalGitCredentialPromptGuard(
  env: Record<string, string>,
  platform: NodeJS.Platform = process.platform
): void {
  const existingState = parseTerminalGitCredentialGuardState(
    env[TERMINAL_GIT_CREDENTIAL_GUARD_STATE_ENV]
  )
  if (existingState) {
    if (isGuardIntact(env, existingState, platform)) {
      return
    }
    // Why: ownership alone is not proof that inherited shells still carry the
    // safety guard; release it before recording a fresh, verifiable baseline.
    clearTerminalGitCredentialPromptGuard(env)
  }

  const previousState = readOwnEnvValue(env, TERMINAL_GIT_CREDENTIAL_GUARD_STATE_ENV)
  const previous = {
    GIT_TERMINAL_PROMPT: readOwnEnvValue(env, 'GIT_TERMINAL_PROMPT'),
    GCM_INTERACTIVE: readOwnEnvValue(env, 'GCM_INTERACTIVE'),
    GIT_ASKPASS: readOwnEnvValue(env, 'GIT_ASKPASS'),
    SSH_ASKPASS: readOwnEnvValue(env, 'SSH_ASKPASS'),
    WSLENV: readOwnEnvValue(env, 'WSLENV')
  }
  const configStart = readValidGitConfigEnvCount(env)
  const guarded = gitCredentialPromptGuardEnv(env, platform) as Record<string, string>
  if (platform === 'win32') {
    // Why: nested Orca instances inside WSL need the ownership marker so an
    // opted-out user terminal can restore only the guard Orca injected.
    addWslEnvKeys(guarded, [TERMINAL_GIT_CREDENTIAL_GUARD_STATE_ENV])
  }
  const state: TerminalGitCredentialGuardState = {
    version: 1,
    previous,
    previousState,
    previousGitConfigCount: readOwnEnvValue(env, 'GIT_CONFIG_COUNT'),
    guardedWslEnv: readOwnEnvValue(guarded, 'WSLENV'),
    configStart
  }
  guarded[TERMINAL_GIT_CREDENTIAL_GUARD_STATE_ENV] = JSON.stringify(state)
  Object.assign(env, guarded)
}

function restoreScalarIfUnchanged(
  env: Record<string, string>,
  key: GuardedScalarKey,
  guardedValue: string,
  previousValue: string | null
): void {
  if (env[key] !== guardedValue) {
    return
  }
  if (previousValue === null) {
    delete env[key]
  } else {
    env[key] = previousValue
  }
}

function removeOwnedGitConfigEntries(
  env: Record<string, string>,
  state: TerminalGitCredentialGuardState
): Map<number, number> | null {
  const start = state.configStart
  if (start === null) {
    return null
  }
  const count = readValidGitConfigEnvCount(env)
  if (count === null || count < start + GUARD_CONFIG_ENTRIES.length) {
    return null
  }
  const removableIndexes = new Set<number>()
  for (const [offset, [expectedKey, expectedValue]] of GUARD_CONFIG_ENTRIES.entries()) {
    const index = start + offset
    if (
      env[`GIT_CONFIG_KEY_${index}`] === expectedKey &&
      env[`GIT_CONFIG_VALUE_${index}`] === expectedValue
    ) {
      removableIndexes.add(index)
    }
  }
  if (removableIndexes.size === 0) {
    return null
  }

  const kept: { oldIndex: number; key: string; value: string }[] = []
  for (let index = 0; index < count; index++) {
    const key = env[`GIT_CONFIG_KEY_${index}`]
    const value = env[`GIT_CONFIG_VALUE_${index}`]
    if (key === undefined || value === undefined) {
      return null
    }
    if (!removableIndexes.has(index)) {
      kept.push({ oldIndex: index, key, value })
    }
  }

  const indexMap = new Map<number, number>()
  kept.forEach((entry, newIndex) => {
    indexMap.set(entry.oldIndex, newIndex)
    env[`GIT_CONFIG_KEY_${newIndex}`] = entry.key
    env[`GIT_CONFIG_VALUE_${newIndex}`] = entry.value
  })
  for (let index = kept.length; index < count; index++) {
    delete env[`GIT_CONFIG_KEY_${index}`]
    delete env[`GIT_CONFIG_VALUE_${index}`]
  }
  const removedEntireGuard = removableIndexes.size === GUARD_CONFIG_ENTRIES.length
  const hasEntriesAfterGuard = count > start + GUARD_CONFIG_ENTRIES.length
  if (removedEntireGuard && !hasEntriesAfterGuard && state.previousGitConfigCount !== null) {
    env.GIT_CONFIG_COUNT = state.previousGitConfigCount
  } else if (kept.length === 0) {
    delete env.GIT_CONFIG_COUNT
  } else {
    env.GIT_CONFIG_COUNT = String(kept.length)
  }
  return indexMap
}

function wslenvTokenName(token: string): string {
  return token.split('/')[0]
}

/** Remove only a guard carrying Orca's valid ownership record. */
export function clearTerminalGitCredentialPromptGuard(env: Record<string, string>): void {
  const state = parseTerminalGitCredentialGuardState(env[TERMINAL_GIT_CREDENTIAL_GUARD_STATE_ENV])
  if (!state) {
    return
  }

  restoreScalarIfUnchanged(env, 'GIT_TERMINAL_PROMPT', '0', state.previous.GIT_TERMINAL_PROMPT)
  restoreScalarIfUnchanged(env, 'GCM_INTERACTIVE', 'never', state.previous.GCM_INTERACTIVE)
  restoreScalarIfUnchanged(
    env,
    'GIT_ASKPASS',
    state.previous.GIT_ASKPASS ?? '',
    state.previous.GIT_ASKPASS
  )
  restoreScalarIfUnchanged(
    env,
    'SSH_ASKPASS',
    state.previous.SSH_ASKPASS ?? '',
    state.previous.SSH_ASKPASS
  )
  const configIndexMap = removeOwnedGitConfigEntries(env, state)
  restoreTerminalGitCredentialGuardWslEnv(env, state, configIndexMap)

  if (state.previousState === null) {
    delete env[TERMINAL_GIT_CREDENTIAL_GUARD_STATE_ENV]
  } else {
    env[TERMINAL_GIT_CREDENTIAL_GUARD_STATE_ENV] = state.previousState
  }
}

/**
 * Disable Git credential UI for unattended agent terminals and, by default,
 * user terminals hosted on Windows.
 */
export function applyTerminalGitCredentialPromptGuard(
  env: Record<string, string>,
  opts: {
    launchCommand?: string | null
    suppressUserTerminalPrompt: boolean
    platform?: NodeJS.Platform
    /** A detached host will apply or clear the policy after its final merge. */
    deferGitConfigGuardToHost?: boolean
  }
): void {
  const isAgentTerminal = Boolean(
    recognizeAgentProcessFromCommandLine(opts.launchCommand, { includeHeadlessOneShot: true })
  )
  const platform = opts.platform ?? process.platform
  const shouldGuard = isAgentTerminal || (opts.suppressUserTerminalPrompt && platform === 'win32')

  if (!shouldGuard) {
    clearTerminalGitCredentialPromptGuard(env)
    if (opts.deferGitConfigGuardToHost) {
      env[TERMINAL_GIT_CREDENTIAL_GUARD_POLICY_ENV] = 'clear'
    }
    return
  }
  if (!opts.deferGitConfigGuardToHost) {
    ensureTerminalGitCredentialPromptGuard(env, platform)
    return
  }

  env[TERMINAL_GIT_CREDENTIAL_GUARD_POLICY_ENV] = 'guard'
  const hadWslEnv = 'WSLENV' in env
  for (const [key, value] of Object.entries(gitCredentialPromptGuardEnv(env, platform))) {
    if (typeof value !== 'string') {
      continue
    }
    if (GIT_CONFIG_PROTOCOL_KEY_RE.test(key)) {
      continue
    }
    if (key === 'WSLENV' && !hadWslEnv) {
      continue
    }
    if ((key === 'GIT_ASKPASS' || key === 'SSH_ASKPASS') && !(key in env)) {
      continue
    }
    env[key] = value
  }
}

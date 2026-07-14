import {
  readOwnEnvValue,
  type TerminalGitCredentialGuardState
} from './terminal-git-credential-guard-state'

const WSLENV_CONFIG_INDEX_RE = /^(GIT_CONFIG_(?:KEY|VALUE)_)(\d+)(\/.*)?$/
const OWNED_CONFIG_ENTRY_COUNT = 2

function wslenvTokenName(token: string): string {
  return token.split('/')[0]
}

function countTokens(tokens: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1)
  }
  return counts
}

export function restoreTerminalGitCredentialGuardWslEnv(
  env: Record<string, string>,
  state: TerminalGitCredentialGuardState,
  configIndexMap: Map<number, number> | null
): void {
  const current = readOwnEnvValue(env, 'WSLENV')
  const configStart = state.configStart
  const hasPostGuardCallerEntry =
    configStart !== null &&
    configIndexMap !== null &&
    [...configIndexMap.keys()].some((index) => index >= configStart)
  const retainedGuardIndexes = new Set(
    configStart === null || !configIndexMap
      ? []
      : [...configIndexMap.keys()].filter(
          (index) => index >= configStart && index < configStart + OWNED_CONFIG_ENTRY_COUNT
        )
  )
  if (current === state.guardedWslEnv && retainedGuardIndexes.size === 0) {
    if (state.previous.WSLENV === null) {
      delete env.WSLENV
    } else {
      env.WSLENV = state.previous.WSLENV
    }
    return
  }
  if (current === null || state.guardedWslEnv === null) {
    return
  }

  const previousTokenCounts = countTokens((state.previous.WSLENV ?? '').split(':').filter(Boolean))
  const ownedTokenCounts = countTokens(state.guardedWslEnv.split(':').filter(Boolean))
  for (const [token, count] of previousTokenCounts) {
    ownedTokenCounts.set(token, Math.max(0, (ownedTokenCounts.get(token) ?? 0) - count))
  }
  const tokens = current.split(':').flatMap((token) => {
    const match = token.match(WSLENV_CONFIG_INDEX_RE)
    const oldIndex = match ? Number(match[2]) : null
    const mappedIndex = oldIndex === null ? undefined : configIndexMap?.get(oldIndex)
    const transfersOwnedConfigToken =
      mappedIndex !== undefined &&
      (hasPostGuardCallerEntry || (oldIndex !== null && retainedGuardIndexes.has(oldIndex)))
    const ownedCount = ownedTokenCounts.get(token) ?? 0
    if (ownedCount > 0 && !transfersOwnedConfigToken) {
      ownedTokenCounts.set(token, ownedCount - 1)
      return []
    }
    if (match && configIndexMap) {
      if (mappedIndex === undefined) {
        return [token]
      }
      return [`${match[1]}${mappedIndex}${match[3] ?? ''}`]
    }
    return [token]
  })
  const tokenNames = new Set(tokens.map(wslenvTokenName))
  const count = Number(env.GIT_CONFIG_COUNT ?? '0')
  const hasCompleteForwarding =
    Number.isSafeInteger(count) &&
    count > 0 &&
    Array.from(
      { length: count },
      (_, index) =>
        tokenNames.has(`GIT_CONFIG_KEY_${index}`) && tokenNames.has(`GIT_CONFIG_VALUE_${index}`)
    ).every(Boolean)
  // Why: caller entries created after ownership began need a complete WSL
  // protocol, while untouched pre-guard config must return to its original state.
  if (hasPostGuardCallerEntry && hasCompleteForwarding && !tokenNames.has('GIT_CONFIG_COUNT')) {
    tokens.push('GIT_CONFIG_COUNT')
  }
  if (tokens.length === 0 && state.previous.WSLENV === null) {
    delete env.WSLENV
  } else {
    env.WSLENV = tokens.join(':')
  }
}

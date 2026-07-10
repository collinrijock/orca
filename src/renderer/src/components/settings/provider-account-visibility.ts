import type {
  ClaudeRateLimitAccountsState,
  CodexRateLimitAccountsState
} from '../../../../shared/types'

type ProviderAccount =
  | ClaudeRateLimitAccountsState['accounts'][number]
  | CodexRateLimitAccountsState['accounts'][number]

export type ProviderAccountRuntimeView = {
  runtime: 'host' | 'wsl'
  wslDistro?: string | null
}

export function providerAccountMatchesView(
  account: ProviderAccount,
  runtime: ProviderAccountRuntimeView,
  options: {
    remoteOwner: boolean
    ownerPlatform: NodeJS.Platform | null
  }
): boolean {
  const accountRuntime =
    'authMethod' in account
      ? (account.managedAuthRuntime ?? 'host')
      : (account.managedHomeRuntime ?? 'host')
  const accountDistro = account.wslDistro ?? null

  if (options.remoteOwner) {
    // Why: provider accounts belong to the Orca runtime, not its client or a
    // downstream SSH host; a Windows runtime owns both host and WSL accounts.
    return options.ownerPlatform === 'win32' || accountRuntime !== 'wsl'
  }
  if (runtime.runtime === 'host') {
    return accountRuntime !== 'wsl'
  }
  if (accountRuntime !== 'wsl') {
    return false
  }
  return runtime.wslDistro ? accountDistro === runtime.wslDistro : true
}

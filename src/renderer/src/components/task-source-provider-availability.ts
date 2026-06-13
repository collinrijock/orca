import { parseExecutionHostId } from '../../../shared/execution-host'
import type { TaskProvider } from '../../../shared/types'
import type { PreflightStatus } from '../../../preload/api-types'
import type { TaskSourceContext } from '../../../shared/task-source-context'
import type { TaskSourceHostAvailability } from './task-source-context-summary'

type ProviderToolStatus = {
  installed: boolean
  authenticated: boolean
}

function isDesktopOwnedHost(hostId: TaskSourceContext['hostId']): boolean {
  const parsed = parseExecutionHostId(hostId)
  return parsed?.kind !== 'runtime'
}

function getRepoBackedProviderToolStatus(
  provider: Extract<TaskProvider, 'github' | 'gitlab'>,
  preflightStatus: PreflightStatus | null
): ProviderToolStatus | null {
  if (!preflightStatus) {
    return null
  }
  if (provider === 'github') {
    return preflightStatus.gh
  }
  return preflightStatus.glab ?? { installed: false, authenticated: false }
}

function getProviderReason(
  status: ProviderToolStatus
): TaskSourceHostAvailability['reason'] | null {
  if (!status.installed) {
    return 'unavailable-source-tool'
  }
  if (!status.authenticated) {
    return 'missing-provider-auth'
  }
  return null
}

export function getRepoBackedProviderAvailability(args: {
  provider: Extract<TaskProvider, 'github' | 'gitlab'>
  contexts: readonly TaskSourceContext[]
  preflightStatus: PreflightStatus | null
  preflightReady: boolean
}): TaskSourceHostAvailability[] {
  if (!args.preflightReady) {
    return []
  }
  const status = getRepoBackedProviderToolStatus(args.provider, args.preflightStatus)
  if (!status) {
    return []
  }
  const reason = getProviderReason(status)
  if (!reason) {
    return []
  }
  return args.contexts
    .filter((context) => isDesktopOwnedHost(context.hostId))
    .map((context) => ({ hostId: context.hostId, reason }))
}

import type { IPtyProvider } from '../providers/types'
import { deleteProviderRoute, type ProviderRoute } from './pty-provider-route-reconciliation'

export async function shutdownDegradedFallbackSessions<T extends IPtyProvider>(
  sessionProviders: Map<string, ProviderRoute<T>>,
  fallback: T
): Promise<number> {
  const routes = [...sessionProviders].filter(([, route]) => route.provider === fallback)
  const shutdownResults = await Promise.allSettled(
    routes.map(([id]) => fallback.shutdown(id, { immediate: true }))
  )
  let liveIds: Set<string> | null = null
  let listingError: unknown = null
  if (fallback.requiresShutdownExitProof && routes.length > 0) {
    try {
      // Why: daemon restart can drain many fallback PTYs at once. One shared
      // inventory proves every accepted shutdown without an O(N²) scan.
      liveIds = new Set((await fallback.listProcesses()).map((session) => session.id))
    } catch (error) {
      listingError = error
    }
  }
  const failed: unknown[] = []
  for (const [index, [id, route]] of routes.entries()) {
    const shutdownResult = shutdownResults[index]
    const failure = fallback.requiresShutdownExitProof
      ? (listingError ??
        (liveIds?.has(id)
          ? shutdownResult.status === 'rejected'
            ? shutdownResult.reason
            : new Error(`Fallback PTY "${id}" shutdown is accepted but exit is not confirmed`)
          : null))
      : shutdownResult.status === 'rejected'
        ? shutdownResult.reason
        : null
    if (failure) {
      failed.push(failure)
    } else {
      deleteProviderRoute(sessionProviders, id, route)
    }
  }
  if (failed.length > 0) {
    console.warn(
      `[daemon] ${failed.length} local fallback PTY session(s) could not prove exit; blocking daemon replacement`,
      ...failed
    )
    // Why: replacing the degraded provider would make these exact local PTYs
    // unreachable. Keep the old provider and routes intact until exit is proved.
    throw new AggregateError(
      failed,
      'Cannot restart daemon while local fallback PTY exit remains unconfirmed'
    )
  }
  return routes.length
}

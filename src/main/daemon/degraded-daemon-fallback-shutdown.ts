import type { IPtyProvider } from '../providers/types'
import { deleteProviderRoute, type ProviderRoute } from './pty-provider-route-reconciliation'

export async function shutdownDegradedFallbackSessions<T extends IPtyProvider>(
  sessionProviders: Map<string, ProviderRoute<T>>,
  fallback: T
): Promise<number> {
  const routes = [...sessionProviders].filter(([, route]) => route.provider === fallback)
  const results = await Promise.allSettled(
    routes.map(async ([id, route]) => {
      await fallback.shutdown(id, { immediate: true })
      deleteProviderRoute(sessionProviders, id, route)
    })
  )
  // Why: fallback cleanup must not abort the user's daemon-restart recovery path.
  const failed = results.filter((result) => result.status === 'rejected')
  if (failed.length > 0) {
    console.warn(
      `[daemon] ${failed.length} local fallback PTY session(s) failed to shut down during daemon restart; continuing restart`,
      ...failed.map((result) => (result as PromiseRejectedResult).reason)
    )
  }
  return results.length - failed.length
}

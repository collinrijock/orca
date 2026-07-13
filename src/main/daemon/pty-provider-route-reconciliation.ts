import type { IPtyProvider, PtyProcessInfo } from '../providers/types'

export type ProviderRoute<T> = Readonly<{ provider: T }>

export function bindProviderRoute<T>(
  routes: Map<string, ProviderRoute<T>>,
  id: string,
  provider: T
): ProviderRoute<T> {
  // Why: the immutable binding object is the generation token; rebinding the
  // same id to the same provider must still fence older async readbacks.
  const route = { provider }
  routes.set(id, route)
  return route
}

export function bindProviderRouteIfAbsent<T>(
  routes: Map<string, ProviderRoute<T>>,
  id: string,
  provider: T
): void {
  if (!routes.has(id)) {
    bindProviderRoute(routes, id, provider)
  }
}

export function deleteProviderRoute<T>(
  routes: Map<string, ProviderRoute<T>>,
  id: string,
  expectedRoute?: ProviderRoute<T>
): boolean {
  if (expectedRoute && routes.get(id) !== expectedRoute) {
    return false
  }
  return routes.delete(id)
}

export function reconcileProviderRoutesAfterStartup<T>(
  routes: Map<string, ProviderRoute<T>>,
  routesAtStart: Map<string, ProviderRoute<T>>,
  provider: T,
  result: { alive: string[]; killed: string[] }
): void {
  // Why: startup reconciliation may overlap a respawn; only its unchanged
  // binding generation may be replaced or removed by the older readback.
  for (const id of result.alive) {
    if (routes.get(id) === routesAtStart.get(id)) {
      bindProviderRoute(routes, id, provider)
    }
  }
  for (const id of result.killed) {
    const routeAtStart = routesAtStart.get(id)
    if (routeAtStart) {
      deleteProviderRoute(routes, id, routeAtStart)
    }
  }
}

export function appendProviderReconciliationIds(
  target: { alive: string[]; killed: string[] },
  result: { alive: string[]; killed: string[] }
): void {
  // Why: daemon startup can return enough sessions to exceed JavaScript's
  // argument limit if these arrays are appended with spread syntax.
  for (const id of result.alive) {
    target.alive.push(id)
  }
  for (const id of result.killed) {
    target.killed.push(id)
  }
}

export async function listProviderProcessesAndReconcileRoutes<T extends IPtyProvider>(
  providers: readonly T[],
  routes: Map<string, ProviderRoute<T>>
): Promise<PtyProcessInfo[]> {
  const routesAtStart = [...routes]
  const listings = await Promise.all(
    providers.map(async (provider) => ({ provider, sessions: await provider.listProcesses() }))
  )
  const liveIdsByProvider = new Map(
    listings.map(({ provider, sessions }) => [provider, new Set(sessions.map(({ id }) => id))])
  )
  for (const [id, route] of routesAtStart) {
    // Why: spawn/exit can mutate routing while remote listings are in flight.
    // Compare the exact binding, not only its provider: ids can be rebound to
    // a new process on the same provider while this snapshot is pending.
    if (routes.get(id) === route && !liveIdsByProvider.get(route.provider)?.has(id)) {
      routes.delete(id)
    }
  }
  return listings.flatMap(({ sessions }) => sessions)
}

export function providerSessionIds<T>(
  routes: Map<string, ProviderRoute<T>>,
  provider: T
): string[] {
  return [...routes].filter(([, route]) => route.provider === provider).map(([id]) => id)
}

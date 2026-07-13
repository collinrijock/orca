import type { IPtyProvider, PtyProcessInfo } from '../providers/types'

export type ProviderRoute<T> = Readonly<{ provider: T }>

type RouteMutationObserver = { mutatedIds: Set<string> }

export type ProviderRouteSnapshot<T> = RouteMutationObserver & {
  routesAtStart: Map<string, ProviderRoute<T>>
  dispose: () => void
}

const routeMutationObservers = new WeakMap<object, Set<RouteMutationObserver>>()

function markProviderRouteMutation<T>(routes: Map<string, ProviderRoute<T>>, id: string): void {
  for (const observer of routeMutationObservers.get(routes) ?? []) {
    observer.mutatedIds.add(id)
  }
}

export function captureProviderRouteSnapshot<T>(
  routes: Map<string, ProviderRoute<T>>
): ProviderRouteSnapshot<T> {
  const observer: RouteMutationObserver = { mutatedIds: new Set() }
  const observers = routeMutationObservers.get(routes) ?? new Set()
  observers.add(observer)
  routeMutationObservers.set(routes, observers)
  let active = true
  return {
    routesAtStart: new Map(routes),
    mutatedIds: observer.mutatedIds,
    dispose: () => {
      if (!active) {
        return
      }
      active = false
      observers.delete(observer)
      if (observers.size === 0) {
        routeMutationObservers.delete(routes)
      }
    }
  }
}

function providerRouteIsUnchanged<T>(
  routes: Map<string, ProviderRoute<T>>,
  snapshot: ProviderRouteSnapshot<T>,
  id: string
): boolean {
  return !snapshot.mutatedIds.has(id) && routes.get(id) === snapshot.routesAtStart.get(id)
}

export function bindProviderRoute<T>(
  routes: Map<string, ProviderRoute<T>>,
  id: string,
  provider: T
): ProviderRoute<T> {
  // Why: the immutable binding object is the generation token; rebinding the
  // same id to the same provider must still fence older async readbacks.
  const route = { provider }
  markProviderRouteMutation(routes, id)
  routes.set(id, route)
  return route
}

export function deleteProviderRoute<T>(
  routes: Map<string, ProviderRoute<T>>,
  id: string,
  expectedRoute?: ProviderRoute<T>
): boolean {
  if (expectedRoute && routes.get(id) !== expectedRoute) {
    return false
  }
  const deleted = routes.delete(id)
  if (deleted) {
    markProviderRouteMutation(routes, id)
  }
  return deleted
}

export function reconcileProviderRoutesAfterStartup<T>(
  routes: Map<string, ProviderRoute<T>>,
  snapshot: ProviderRouteSnapshot<T>,
  provider: T,
  result: { alive: string[]; killed: string[] }
): void {
  // Why: startup reconciliation may overlap a respawn; only its unchanged
  // binding generation may be replaced or removed by the older readback.
  for (const id of result.alive) {
    if (providerRouteIsUnchanged(routes, snapshot, id)) {
      bindProviderRoute(routes, id, provider)
    }
  }
  for (const id of result.killed) {
    const routeAtStart = snapshot.routesAtStart.get(id)
    if (routeAtStart) {
      deleteProviderRoute(routes, id, routeAtStart)
    }
  }
}

export async function discoverProviderSessionsAndBindRoutes<T extends IPtyProvider>(
  provider: T,
  routes: Map<string, ProviderRoute<T>>
): Promise<void> {
  const snapshot = captureProviderRouteSnapshot(routes)
  try {
    const sessions = await provider.listProcesses()
    for (const session of sessions) {
      if (providerRouteIsUnchanged(routes, snapshot, session.id)) {
        bindProviderRoute(routes, session.id, provider)
      }
    }
  } finally {
    snapshot.dispose()
  }
}

type StartupReconcilingProvider = IPtyProvider & {
  reconcileOnStartup(validWorktreeIds: Set<string>): Promise<{ alive: string[]; killed: string[] }>
}

export async function reconcileProviderRoutesOnStartup<
  T extends IPtyProvider,
  P extends T & StartupReconcilingProvider
>(
  provider: P,
  routes: Map<string, ProviderRoute<T>>,
  validWorktreeIds: Set<string>
): Promise<{ alive: string[]; killed: string[] }> {
  const snapshot = captureProviderRouteSnapshot(routes)
  try {
    const result = await provider.reconcileOnStartup(validWorktreeIds)
    reconcileProviderRoutesAfterStartup(routes, snapshot, provider, result)
    return result
  } finally {
    snapshot.dispose()
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
  const snapshot = captureProviderRouteSnapshot(routes)
  try {
    const listings = await Promise.all(
      providers.map(async (provider) => ({ provider, sessions: await provider.listProcesses() }))
    )
    const liveIdsByProvider = new Map(
      listings.map(({ provider, sessions }) => [provider, new Set(sessions.map(({ id }) => id))])
    )
    for (const [id, route] of snapshot.routesAtStart) {
      // Why: spawn/exit can mutate routing while remote listings are in flight.
      // Exact snapshot mutation tracking also fences absent-present-absent ABA.
      if (
        providerRouteIsUnchanged(routes, snapshot, id) &&
        !liveIdsByProvider.get(route.provider)?.has(id)
      ) {
        deleteProviderRoute(routes, id, route)
      }
    }
    return listings.flatMap(({ sessions }) => sessions)
  } finally {
    snapshot.dispose()
  }
}

export function providerSessionIds<T>(
  routes: Map<string, ProviderRoute<T>>,
  provider: T
): string[] {
  return [...routes].filter(([, route]) => route.provider === provider).map(([id]) => id)
}

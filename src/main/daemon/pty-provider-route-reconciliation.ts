import type { IPtyProvider, PtyProcessInfo } from '../providers/types'

export type ProviderRoute<T> = Readonly<{ provider: T }>

export type ManagedPtyProvider = IPtyProvider & {
  disconnectOnly?: () => Promise<void>
  dispose?: () => void
}

type ProviderRouteDeferredExit<T> = {
  provider: T
  payload: { id: string; code: number }
}

type ProviderRouteSpawnAdmission<T> = {
  id: string
  deferredExits: ProviderRouteDeferredExit<T>[]
}

type RouteMutationObserver = { mutatedIds: Set<string> }

export type ProviderRouteSnapshot<T> = RouteMutationObserver & {
  routesAtStart: Map<string, ProviderRoute<T>>
  dispose: () => void
}

const routeMutationObservers = new WeakMap<object, Set<RouteMutationObserver>>()

function beginProviderRouteSpawnAdmission<T>(
  admissions: Map<string, ProviderRouteSpawnAdmission<T>>,
  id: string
): ProviderRouteSpawnAdmission<T> {
  const admission = { id, deferredExits: [] }
  admissions.set(id, admission)
  return admission
}

function deferProviderRouteExitDuringSpawn<T>(
  admissions: Map<string, ProviderRouteSpawnAdmission<T>>,
  provider: T,
  payload: { id: string; code: number }
): boolean {
  const admission = admissions.get(payload.id)
  if (!admission) {
    return false
  }
  const existing = admission.deferredExits.find((exit) => exit.provider === provider)
  if (existing) {
    existing.payload = payload
  } else {
    // Why: providers may duplicate an exit callback; retain at most one event
    // per bounded provider while a replacement spawn is unresolved.
    admission.deferredExits.push({ provider, payload })
  }
  return true
}

function settleProviderRouteSpawnAdmission<T extends IPtyProvider>(
  admissions: Map<string, ProviderRouteSpawnAdmission<T>>,
  admission: ProviderRouteSpawnAdmission<T>,
  routes: Map<string, ProviderRoute<T>>
): ProviderRouteDeferredExit<T>[] {
  if (admissions.get(admission.id) !== admission) {
    return []
  }
  admissions.delete(admission.id)
  const route = routes.get(admission.id)
  return admission.deferredExits.filter(({ provider }) => {
    if (route && route.provider !== provider) {
      return false
    }
    const owner = route?.provider ?? provider
    // Why: an exit that races replacement admission is ambiguous. Deliver it
    // only when the exact provider can prove no same-id process survived.
    return owner.hasPty?.(admission.id) === false
  })
}

export class ProviderRouteSpawnExitFence<T extends IPtyProvider> {
  private admissions = new Map<string, ProviderRouteSpawnAdmission<T>>()

  constructor(
    private routes: Map<string, ProviderRoute<T>>,
    private handleExit: (exit: ProviderRouteDeferredExit<T>) => void
  ) {}

  deferExit(provider: T, payload: { id: string; code: number }): boolean {
    return deferProviderRouteExitDuringSpawn(this.admissions, provider, payload)
  }

  async spawn<R extends { id: string }>(
    requestedId: string | undefined,
    provider: T,
    spawn: () => Promise<R>
  ): Promise<R> {
    const admission = requestedId
      ? beginProviderRouteSpawnAdmission(this.admissions, requestedId)
      : null
    try {
      const result = await spawn()
      bindProviderRoute(this.routes, result.id, provider)
      this.settle(admission)
      return result
    } catch (error) {
      this.settle(admission)
      throw error
    }
  }

  clear(): void {
    this.admissions.clear()
  }

  private settle(admission: ProviderRouteSpawnAdmission<T> | null): void {
    if (!admission) {
      return
    }
    for (const deferred of settleProviderRouteSpawnAdmission(
      this.admissions,
      admission,
      this.routes
    )) {
      this.handleExit(deferred)
    }
  }
}

export function forwardProviderRouteExit<T>(
  routes: Map<string, ProviderRoute<T>>,
  provider: T,
  payload: { id: string; code: number },
  listeners: ((payload: { id: string; code: number }) => void)[]
): void {
  // Why: a late child exit must not delete or fan out across a route already
  // rebound to a replacement provider generation.
  const route = routes.get(payload.id)
  if (route && route.provider !== provider) {
    return
  }
  if (route?.provider === provider) {
    deleteProviderRoute(routes, payload.id, route)
  }
  for (const listener of listeners) {
    listener(payload)
  }
}

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

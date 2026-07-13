import { describe, expect, it } from 'vitest'
import {
  bindProviderRoute,
  captureProviderRouteSnapshot,
  deleteProviderRoute,
  reconcileProviderRoutesAfterStartup,
  type ProviderRoute
} from './pty-provider-route-reconciliation'

describe('provider route reconciliation generations', () => {
  it('fences absent-present-absent ABA during startup readback', () => {
    const provider = { label: 'startup-owner' }
    const routes = new Map<string, ProviderRoute<typeof provider>>()
    const snapshot = captureProviderRouteSnapshot(routes)

    bindProviderRoute(routes, 'same-id', provider)
    deleteProviderRoute(routes, 'same-id')
    reconcileProviderRoutesAfterStartup(routes, snapshot, provider, {
      alive: ['same-id'],
      killed: []
    })
    snapshot.dispose()

    expect(routes.has('same-id')).toBe(false)
  })

  it('stops retaining route mutation ids after snapshot disposal', () => {
    const provider = { label: 'owner' }
    const routes = new Map<string, ProviderRoute<typeof provider>>()
    const snapshot = captureProviderRouteSnapshot(routes)
    bindProviderRoute(routes, 'observed', provider)
    snapshot.dispose()

    bindProviderRoute(routes, 'after-dispose', provider)

    expect([...snapshot.mutatedIds]).toEqual(['observed'])
  })
})

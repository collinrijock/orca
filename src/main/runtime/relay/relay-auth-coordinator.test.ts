import { describe, expect, it, vi } from 'vitest'
import { RelayAuthCoordinator, type RelayAuthContext } from './relay-auth-coordinator'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

const context: RelayAuthContext = {
  identity: { userId: 'user-1', profileId: 'profile-1', organizationId: 'org-1' },
  accessToken: 'access-1',
  relayEntitled: true
}

describe('RelayAuthCoordinator', () => {
  it('fences a session read that finishes after sign-out', async () => {
    const read = deferred<RelayAuthContext | null>()
    const openBroker = vi.fn()
    const statuses: string[] = []
    const coordinator = new RelayAuthCoordinator({
      readContext: () => read.promise,
      openBroker,
      onStatus: (status) => statuses.push(status)
    })
    coordinator.reconcile()
    coordinator.fenceAndCloseNow()
    read.resolve(context)
    await vi.waitFor(() => expect(openBroker).not.toHaveBeenCalled())
    expect(statuses.at(-1)).toBe('offline')
  })

  it('closes a broker whose open finishes after an identity mutation', async () => {
    const opened = deferred<{ closeNow(): void }>()
    const staleClose = vi.fn()
    const readContext = vi
      .fn<() => Promise<RelayAuthContext | null>>()
      .mockResolvedValueOnce(context)
      .mockResolvedValueOnce({
        ...context,
        identity: { ...context.identity, organizationId: 'org-2' }
      })
    const openBroker = vi
      .fn()
      .mockImplementationOnce(() => opened.promise)
      .mockResolvedValueOnce({ closeNow: vi.fn() })
    const coordinator = new RelayAuthCoordinator({
      readContext,
      openBroker,
      onStatus: vi.fn()
    })
    coordinator.reconcile()
    await vi.waitFor(() => expect(openBroker).toHaveBeenCalledOnce())
    coordinator.reconcile()
    await vi.waitFor(() => expect(openBroker).toHaveBeenCalledTimes(2))
    opened.resolve({ closeNow: staleClose })
    await vi.waitFor(() => expect(staleClose).toHaveBeenCalledOnce())
  })

  it('keeps one broker for duplicate events with unchanged identity', async () => {
    const broker = { closeNow: vi.fn() }
    const openBroker = vi.fn(async () => broker)
    const coordinator = new RelayAuthCoordinator({
      readContext: async () => context,
      openBroker,
      onStatus: vi.fn()
    })
    coordinator.reconcile()
    await vi.waitFor(() => expect(openBroker).toHaveBeenCalledOnce())
    coordinator.reconcile()
    await vi.waitFor(() => expect(openBroker).toHaveBeenCalledOnce())
    expect(broker.closeNow).not.toHaveBeenCalled()
  })

  it('rejects a refresh result after capability removal', async () => {
    let current: RelayAuthContext | null = context
    let refreshAccessToken: (() => Promise<string | null>) | null = null
    const coordinator = new RelayAuthCoordinator({
      readContext: async () => current,
      openBroker: async (input) => {
        refreshAccessToken = input.refreshAccessToken
        return { closeNow: vi.fn() }
      },
      onStatus: vi.fn()
    })
    coordinator.reconcile()
    await vi.waitFor(() => expect(refreshAccessToken).not.toBeNull())
    current = { ...context, relayEntitled: false }
    coordinator.reconcile()
    await expect(refreshAccessToken!()).resolves.toBeNull()
  })
})

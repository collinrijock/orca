import { describe, expect, it, vi } from 'vitest'
import { reconcileRetirementPendingDaemonClaims } from './retirement-pending-claim-reconciliation'

function pendingStore() {
  const claim = {
    sessionId: 'pending-session',
    protocolVersion: 22,
    ownerKind: 'retirement-pending' as const,
    workspaceKey: 'repo::/worktree',
    ownerId: 'leaf',
    provider: 'local-daemon' as const
  }
  return {
    getDaemonSessionOwnership: vi.fn(() => ({ claims: [claim] })),
    clearVerifiedRetirementPendingDaemonClaim: vi.fn(() => true)
  }
}

describe('retirement-pending daemon claim reconciliation', () => {
  it('retains a live claim without retrying an identity-incomplete close', async () => {
    const store = pendingStore()
    const provider = {
      listProcessesForBinding: vi.fn(async () => [{ id: 'pending-session' }]),
      shutdown: vi.fn(),
      forgetPtyRouteAfterVerifiedStop: vi.fn(() => true)
    }

    await reconcileRetirementPendingDaemonClaims(store as never, provider as never)

    expect(provider.shutdown).not.toHaveBeenCalled()
    expect(store.clearVerifiedRetirementPendingDaemonClaim).not.toHaveBeenCalled()
    expect(provider.forgetPtyRouteAfterVerifiedStop).not.toHaveBeenCalled()
  })

  it('retains the claim when exact-generation listing is unknown', async () => {
    const store = pendingStore()
    const provider = {
      listProcessesForBinding: vi.fn(async () => {
        throw new Error('adapter unavailable')
      }),
      shutdown: vi.fn(),
      forgetPtyRouteAfterVerifiedStop: vi.fn()
    }

    await reconcileRetirementPendingDaemonClaims(store as never, provider as never)

    expect(store.clearVerifiedRetirementPendingDaemonClaim).not.toHaveBeenCalled()
    expect(provider.shutdown).not.toHaveBeenCalled()
    expect(provider.forgetPtyRouteAfterVerifiedStop).not.toHaveBeenCalled()
  })

  it('clears an already-absent claim without issuing another shutdown', async () => {
    const store = pendingStore()
    const provider = {
      listProcessesForBinding: vi.fn(async () => []),
      shutdown: vi.fn(),
      forgetPtyRouteAfterVerifiedStop: vi.fn(() => true)
    }

    await reconcileRetirementPendingDaemonClaims(store as never, provider as never)

    expect(provider.shutdown).not.toHaveBeenCalled()
    expect(store.clearVerifiedRetirementPendingDaemonClaim).toHaveBeenCalledOnce()
  })
})

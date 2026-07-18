import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IPtyProvider } from './types'
import { PtyNaturalExitReconciliation } from './pty-natural-exit-reconciliation'

const provenance = { kind: 'local-daemon' as const, protocolVersion: 23 }

describe('PtyNaturalExitReconciliation', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('goes dormant after a bounded failure burst and wakes on healthy inventory', async () => {
    vi.useFakeTimers()
    const listProcessesForBinding = vi.fn().mockRejectedValue(new Error('daemon unavailable'))
    const provider = { listProcessesForBinding } as unknown as IPtyProvider
    const finishVerifiedStop = vi.fn(() => true)
    const deliverConfirmedExit = vi.fn()
    const reconciliation = new PtyNaturalExitReconciliation()
    reconciliation.setSink({
      getProvider: () => provider,
      finishVerifiedStop,
      deliverConfirmedExit
    })

    reconciliation.enqueue({ id: 'exited', code: 7, provenance })
    await vi.runAllTimersAsync()

    expect(listProcessesForBinding).toHaveBeenCalledTimes(4)
    expect(finishVerifiedStop).not.toHaveBeenCalled()
    expect(deliverConfirmedExit).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(60 * 60 * 1_000)
    expect(listProcessesForBinding).toHaveBeenCalledTimes(4)

    listProcessesForBinding.mockResolvedValueOnce([])
    reconciliation.notifyInventoryAvailable(provenance)
    await vi.runAllTimersAsync()

    expect(finishVerifiedStop).toHaveBeenCalledOnce()
    expect(deliverConfirmedExit).toHaveBeenCalledWith({ id: 'exited', code: 7, provenance })
  })

  it('coalesces same-provider exits behind one inventory and preserves replacements', async () => {
    const listProcessesForBinding = vi.fn(async () => [{ id: 'replaced' }])
    const provider = { listProcessesForBinding } as unknown as IPtyProvider
    const finishVerifiedStop = vi.fn(() => true)
    const deliverConfirmedExit = vi.fn()
    const reconciliation = new PtyNaturalExitReconciliation()
    reconciliation.setSink({
      getProvider: () => provider,
      finishVerifiedStop,
      deliverConfirmedExit
    })

    reconciliation.enqueue({ id: 'gone', code: 0, provenance })
    reconciliation.enqueue({ id: 'replaced', code: 1, provenance })
    await vi.waitFor(() => expect(listProcessesForBinding).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(deliverConfirmedExit).toHaveBeenCalledOnce())

    expect(finishVerifiedStop).toHaveBeenCalledWith(
      provider,
      expect.objectContaining({ id: 'gone' })
    )
    expect(finishVerifiedStop).not.toHaveBeenCalledWith(
      provider,
      expect.objectContaining({ id: 'replaced' })
    )
  })

  it('cancels a pending natural exit when exact absence supersedes it', async () => {
    vi.useFakeTimers()
    const provider = {
      listProcessesForBinding: vi.fn().mockRejectedValue(new Error('daemon unavailable'))
    } as unknown as IPtyProvider
    const deliverConfirmedExit = vi.fn()
    const reconciliation = new PtyNaturalExitReconciliation()
    reconciliation.setSink({
      getProvider: () => provider,
      finishVerifiedStop: vi.fn(() => true),
      deliverConfirmedExit
    })

    reconciliation.enqueue({ id: 'exact', code: 0, provenance })
    reconciliation.cancel('exact', provenance)
    await vi.runAllTimersAsync()
    reconciliation.notifyInventoryAvailable(provenance)
    await vi.runAllTimersAsync()

    expect(deliverConfirmedExit).not.toHaveBeenCalled()
  })

  it('keeps fenced exits out of inventory reconciliation until explicit stop releases them', async () => {
    const listProcessesForBinding = vi.fn(async () => [])
    const provider = { listProcessesForBinding } as unknown as IPtyProvider
    const finishVerifiedStop = vi.fn(() => true)
    const deliverConfirmedExit = vi.fn()
    const reconciliation = new PtyNaturalExitReconciliation()
    reconciliation.setSink({
      getProvider: () => provider,
      finishVerifiedStop,
      deliverConfirmedExit
    })

    reconciliation.beginExplicitStop('legacy', provenance)
    reconciliation.enqueue({ id: 'legacy', code: 4, provenance })
    reconciliation.notifyInventoryAvailable(provenance)
    await Promise.resolve()

    expect(listProcessesForBinding).not.toHaveBeenCalled()
    expect(finishVerifiedStop).not.toHaveBeenCalled()
    expect(deliverConfirmedExit).not.toHaveBeenCalled()
    expect(reconciliation.completeExplicitStop('legacy', provenance)).toEqual({
      id: 'legacy',
      code: 4,
      provenance
    })
  })

  it('does not let an in-flight inventory consume an exit claimed by explicit stop', async () => {
    let resolveInventory: ((value: { id: string }[]) => void) | undefined
    const provider = {
      listProcessesForBinding: vi.fn(
        () =>
          new Promise<{ id: string }[]>((resolve) => {
            resolveInventory = resolve
          })
      )
    } as unknown as IPtyProvider
    const finishVerifiedStop = vi.fn(() => true)
    const deliverConfirmedExit = vi.fn()
    const reconciliation = new PtyNaturalExitReconciliation()
    reconciliation.setSink({
      getProvider: () => provider,
      finishVerifiedStop,
      deliverConfirmedExit
    })
    reconciliation.enqueue({ id: 'legacy', code: 5, provenance })
    await vi.waitFor(() => expect(provider.listProcessesForBinding).toHaveBeenCalledOnce())

    reconciliation.beginExplicitStop('legacy', provenance)
    resolveInventory?.([])
    await Promise.resolve()

    expect(reconciliation.completeExplicitStop('legacy', provenance)).toEqual({
      id: 'legacy',
      code: 5,
      provenance
    })
    expect(finishVerifiedStop).not.toHaveBeenCalled()
    expect(deliverConfirmedExit).not.toHaveBeenCalled()
  })

  it('retains pending proof when durable ownership cleanup throws', async () => {
    vi.useFakeTimers()
    const provider = {
      listProcessesForBinding: vi.fn(async () => [])
    } as unknown as IPtyProvider
    const finishVerifiedStop = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('disk full')
      })
      .mockReturnValue(true)
    const deliverConfirmedExit = vi.fn()
    const reconciliation = new PtyNaturalExitReconciliation()
    reconciliation.setSink({
      getProvider: () => provider,
      finishVerifiedStop,
      deliverConfirmedExit
    })

    reconciliation.enqueue({ id: 'durable', code: 9, provenance })
    await vi.runAllTimersAsync()

    expect(finishVerifiedStop).toHaveBeenCalledTimes(2)
    expect(deliverConfirmedExit).toHaveBeenCalledWith({ id: 'durable', code: 9, provenance })
  })

  it('revalidates through the current provider and sink after an in-flight swap', async () => {
    vi.useFakeTimers()
    let resolveOldInventory: ((value: { id: string }[]) => void) | undefined
    const oldProvider = {
      listProcessesForBinding: vi.fn(
        () =>
          new Promise<{ id: string }[]>((resolve) => {
            resolveOldInventory = resolve
          })
      )
    } as unknown as IPtyProvider
    const newProvider = {
      listProcessesForBinding: vi.fn(async () => [])
    } as unknown as IPtyProvider
    const oldFinish = vi.fn(() => true)
    const oldDeliver = vi.fn()
    const newFinish = vi.fn(() => true)
    const newDeliver = vi.fn()
    const reconciliation = new PtyNaturalExitReconciliation()
    reconciliation.setSink({
      getProvider: () => oldProvider,
      finishVerifiedStop: oldFinish,
      deliverConfirmedExit: oldDeliver
    })
    reconciliation.enqueue({ id: 'swapped', code: 3, provenance })
    await vi.waitFor(() => expect(oldProvider.listProcessesForBinding).toHaveBeenCalledOnce())

    reconciliation.setSink({
      getProvider: () => newProvider,
      finishVerifiedStop: newFinish,
      deliverConfirmedExit: newDeliver
    })
    resolveOldInventory?.([])
    await vi.runAllTimersAsync()

    expect(oldFinish).not.toHaveBeenCalled()
    expect(oldDeliver).not.toHaveBeenCalled()
    expect(newFinish).toHaveBeenCalledOnce()
    expect(newDeliver).toHaveBeenCalledWith({ id: 'swapped', code: 3, provenance })
  })

  it('contains a delivery failure after committed ownership cleanup without retrying', async () => {
    const provider = {
      listProcessesForBinding: vi.fn(async () => [])
    } as unknown as IPtyProvider
    const finishVerifiedStop = vi.fn(() => true)
    const deliverConfirmedExit = vi.fn(() => {
      throw new Error('window destroyed')
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const reconciliation = new PtyNaturalExitReconciliation()
    reconciliation.setSink({
      getProvider: () => provider,
      finishVerifiedStop,
      deliverConfirmedExit
    })

    try {
      reconciliation.enqueue({ id: 'delivered-once', code: 4, provenance })
      await vi.waitFor(() => expect(deliverConfirmedExit).toHaveBeenCalledOnce())
      reconciliation.notifyInventoryAvailable(provenance)
      await Promise.resolve()

      expect(finishVerifiedStop).toHaveBeenCalledOnce()
      expect(deliverConfirmedExit).toHaveBeenCalledOnce()
      expect(consoleError).toHaveBeenCalledOnce()
    } finally {
      consoleError.mockRestore()
    }
  })
})

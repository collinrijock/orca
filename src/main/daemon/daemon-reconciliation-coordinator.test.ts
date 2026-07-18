import { describe, expect, it, vi } from 'vitest'
import {
  DaemonReconciliationCoordinator,
  createProductionDaemonReconciliationCoordinator
} from './daemon-reconciliation-coordinator'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('DaemonReconciliationCoordinator', () => {
  it('keeps production structurally audit-only even with every other authority', () => {
    const coordinator = createProductionDaemonReconciliationCoordinator({
      hasSingleInstanceLock: true,
      developmentLockBypassed: false
    })

    expect(coordinator.canEnforce()).toBe(false)
    expect(coordinator.getEnforcementBlockReasons()).toContain('audit-only-build')
  })

  it('requires exclusive-instance authority and every expected client path', () => {
    const expected = new Set(['adapter', 'health-probe'])
    const coordinator = new DaemonReconciliationCoordinator({
      authority: {
        capability: 'test-enforcement',
        hasSingleInstanceLock: false,
        developmentLockBypassed: true
      },
      expectedClientPaths: expected
    })

    expect(coordinator.getEnforcementBlockReasons()).toEqual([
      'single-instance-lock-unavailable',
      'development-lock-bypassed',
      'unregistered-client-path'
    ])
    const adapter = coordinator.registerClient('adapter')
    const health = coordinator.registerClient('health-probe')
    expect(coordinator.getEnforcementBlockReasons()).not.toContain('unregistered-client-path')
    adapter.close()
    health.close()
  })

  it('rejects client construction outside the static inventory', () => {
    const coordinator = createProductionDaemonReconciliationCoordinator({
      hasSingleInstanceLock: true,
      developmentLockBypassed: false,
      expectedClientPaths: new Set(['adapter'])
    })

    expect(() => coordinator.registerClient('future-raw-socket')).toThrow(
      'Unregistered daemon client path'
    )
  })

  it('waits for an in-flight exact-session operation and blocks a new one behind the fence', async () => {
    const coordinator = createProductionDaemonReconciliationCoordinator({
      hasSingleInstanceLock: true,
      developmentLockBypassed: false
    })
    const firstGate = deferred()
    const fenceGate = deferred()
    const events: string[] = []
    const first = coordinator.withSessionOperation('session-a', async () => {
      events.push('first-start')
      await firstGate.promise
      events.push('first-end')
    })
    const fenced = coordinator.withSessionFence('session-a', async () => {
      events.push('fence-start')
      await fenceGate.promise
      events.push('fence-end')
    })
    await vi.waitFor(() => expect(events).toEqual(['first-start']))

    const second = coordinator.withSessionOperation('session-a', async () => {
      events.push('second')
    })
    firstGate.resolve()
    await vi.waitFor(() => expect(events).toContain('fence-start'))
    expect(events).not.toContain('second')
    fenceGate.resolve()
    await Promise.all([first, fenced, second])
    expect(events).toEqual(['first-start', 'first-end', 'fence-start', 'fence-end', 'second'])
  })

  it('does not pause unrelated session operations', async () => {
    const coordinator = createProductionDaemonReconciliationCoordinator({
      hasSingleInstanceLock: true,
      developmentLockBypassed: false
    })
    const fenceGate = deferred()
    const fenced = coordinator.withSessionFence('session-a', async () => {
      await fenceGate.promise
    })

    await expect(
      coordinator.withSessionOperation('session-b', async () => 'unrelated')
    ).resolves.toBe('unrelated')
    fenceGate.resolve()
    await fenced
  })

  it('waits for mutations and blocks new mutations during final validation', async () => {
    const coordinator = createProductionDaemonReconciliationCoordinator({
      hasSingleInstanceLock: true,
      developmentLockBypassed: false
    })
    const firstGate = deferred()
    const validationGate = deferred()
    const events: string[] = []
    const first = coordinator.withNamespaceMutation(async () => {
      events.push('mutation-one-start')
      await firstGate.promise
      events.push('mutation-one-end')
    })
    const validation = coordinator.withFinalOwnershipValidation(async () => {
      events.push('validation-start')
      await validationGate.promise
      events.push('validation-end')
    })
    const second = coordinator.withNamespaceMutation(async () => {
      events.push('mutation-two')
    })

    firstGate.resolve()
    await vi.waitFor(() => expect(events).toContain('validation-start'))
    expect(events).not.toContain('mutation-two')
    validationGate.resolve()
    await Promise.all([first, validation, second])
    expect(events).toEqual([
      'mutation-one-start',
      'mutation-one-end',
      'validation-start',
      'validation-end',
      'mutation-two'
    ])
  })
})

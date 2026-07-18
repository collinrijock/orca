export type DaemonReconciliationCapability = 'audit-only' | 'test-enforcement'

export type DaemonReconciliationAuthority = {
  hasSingleInstanceLock: boolean
  developmentLockBypassed: boolean
  capability: DaemonReconciliationCapability
}

export type DaemonReconciliationBlockReason =
  | 'audit-only-build'
  | 'single-instance-lock-unavailable'
  | 'development-lock-bypassed'
  | 'unregistered-client-path'

type SessionFence = {
  release: Promise<void>
  resolveRelease: () => void
}

type NamespaceFence = {
  release: Promise<void>
  resolveRelease: () => void
}

export type DaemonClientRegistration = {
  close: () => void
}

/**
 * Serializes the small identity-sensitive windows used by daemon reconciliation.
 * Production construction is deliberately audit-only; enforcement is injectable only in tests.
 */
export class DaemonReconciliationCoordinator {
  private readonly authority: DaemonReconciliationAuthority
  private readonly expectedClientPaths: ReadonlySet<string>
  private readonly registeredClientCounts = new Map<string, number>()
  private readonly sessionFences = new Map<string, SessionFence>()
  private readonly activeSessionOperations = new Map<string, number>()
  private readonly sessionDrainWaiters = new Map<string, Set<() => void>>()
  private namespaceFence: NamespaceFence | null = null
  private activeNamespaceMutations = 0
  private namespaceDrainWaiters = new Set<() => void>()

  constructor(args: {
    authority: DaemonReconciliationAuthority
    expectedClientPaths?: ReadonlySet<string>
  }) {
    this.authority = args.authority
    this.expectedClientPaths = args.expectedClientPaths ?? new Set()
  }

  getEnforcementBlockReasons(): DaemonReconciliationBlockReason[] {
    const reasons: DaemonReconciliationBlockReason[] = []
    if (this.authority.capability !== 'test-enforcement') {
      reasons.push('audit-only-build')
    }
    if (!this.authority.hasSingleInstanceLock) {
      reasons.push('single-instance-lock-unavailable')
    }
    if (this.authority.developmentLockBypassed) {
      reasons.push('development-lock-bypassed')
    }
    if ([...this.expectedClientPaths].some((path) => !this.registeredClientCounts.has(path))) {
      reasons.push('unregistered-client-path')
    }
    return reasons
  }

  canEnforce(): boolean {
    return this.getEnforcementBlockReasons().length === 0
  }

  registerClient(path: string): DaemonClientRegistration {
    if (!this.expectedClientPaths.has(path)) {
      throw new Error(`Unregistered daemon client path: ${path}`)
    }
    this.registeredClientCounts.set(path, (this.registeredClientCounts.get(path) ?? 0) + 1)
    let active = true
    return {
      close: () => {
        if (!active) {
          return
        }
        active = false
        const next = (this.registeredClientCounts.get(path) ?? 1) - 1
        if (next === 0) {
          this.registeredClientCounts.delete(path)
        } else {
          this.registeredClientCounts.set(path, next)
        }
      }
    }
  }

  async withSessionOperation<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    while (this.sessionFences.has(sessionId)) {
      await this.sessionFences.get(sessionId)!.release
    }
    this.activeSessionOperations.set(
      sessionId,
      (this.activeSessionOperations.get(sessionId) ?? 0) + 1
    )
    try {
      return await operation()
    } finally {
      const next = (this.activeSessionOperations.get(sessionId) ?? 1) - 1
      if (next === 0) {
        this.activeSessionOperations.delete(sessionId)
        for (const resolve of this.sessionDrainWaiters.get(sessionId) ?? []) {
          resolve()
        }
        this.sessionDrainWaiters.delete(sessionId)
      } else {
        this.activeSessionOperations.set(sessionId, next)
      }
    }
  }

  async withSessionFence<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    if (this.sessionFences.has(sessionId)) {
      throw new Error(`Daemon session is already fenced: ${sessionId}`)
    }
    let resolveRelease!: () => void
    const release = new Promise<void>((resolve) => {
      resolveRelease = resolve
    })
    this.sessionFences.set(sessionId, { release, resolveRelease })
    try {
      await this.waitForSessionOperations(sessionId)
      return await operation()
    } finally {
      this.sessionFences.delete(sessionId)
      resolveRelease()
    }
  }

  async withNamespaceMutation<T>(mutation: () => Promise<T>): Promise<T> {
    while (this.namespaceFence) {
      await this.namespaceFence.release
    }
    this.activeNamespaceMutations += 1
    try {
      return await mutation()
    } finally {
      this.activeNamespaceMutations -= 1
      if (this.activeNamespaceMutations === 0) {
        for (const resolve of this.namespaceDrainWaiters) {
          resolve()
        }
        this.namespaceDrainWaiters.clear()
      }
    }
  }

  async withFinalOwnershipValidation<T>(validation: () => Promise<T>): Promise<T> {
    if (this.namespaceFence) {
      throw new Error('Daemon namespace is already fenced')
    }
    let resolveRelease!: () => void
    const release = new Promise<void>((resolve) => {
      resolveRelease = resolve
    })
    this.namespaceFence = { release, resolveRelease }
    try {
      await this.waitForNamespaceMutations()
      return await validation()
    } finally {
      this.namespaceFence = null
      resolveRelease()
    }
  }

  private async waitForSessionOperations(sessionId: string): Promise<void> {
    if (!this.activeSessionOperations.has(sessionId)) {
      return
    }
    await new Promise<void>((resolve) => {
      const waiters = this.sessionDrainWaiters.get(sessionId) ?? new Set()
      waiters.add(resolve)
      this.sessionDrainWaiters.set(sessionId, waiters)
    })
  }

  private async waitForNamespaceMutations(): Promise<void> {
    if (this.activeNamespaceMutations === 0) {
      return
    }
    await new Promise<void>((resolve) => {
      this.namespaceDrainWaiters.add(resolve)
    })
  }
}

export function createProductionDaemonReconciliationCoordinator(args: {
  hasSingleInstanceLock: boolean
  developmentLockBypassed: boolean
  expectedClientPaths?: ReadonlySet<string>
}): DaemonReconciliationCoordinator {
  return new DaemonReconciliationCoordinator({
    // Why: the first release may collect evidence but no runtime input can unlock destruction.
    authority: { ...args, capability: 'audit-only' },
    expectedClientPaths: args.expectedClientPaths
  })
}

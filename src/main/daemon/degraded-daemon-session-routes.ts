import type { DaemonPtyAdapter } from './daemon-pty-adapter'
import type { IPtyProvider } from '../providers/types'
import type { TerminalBindingProvenance } from '../../shared/daemon-session-ownership'

export type ManagedDegradedPtyProvider = IPtyProvider & {
  disconnectOnly?: () => Promise<void>
  dispose?: () => void
}

export class DegradedDaemonSessionRoutes {
  private routes = new Map<string, ManagedDegradedPtyProvider>()

  constructor(
    private readonly fallback: ManagedDegradedPtyProvider,
    private readonly daemonAdapters: () => DaemonPtyAdapter[]
  ) {}

  record(sessionId: string, provider: ManagedDegradedPtyProvider): void {
    this.routes.set(sessionId, provider)
  }

  delete(sessionId: string): void {
    this.routes.delete(sessionId)
  }

  forgetAfterVerifiedStop(id: string, expected?: TerminalBindingProvenance): boolean {
    const routed = this.routes.get(id)
    if (routed && expected && !bindingMatches(this.provenanceFor(routed), expected)) {
      return false
    }
    this.routes.delete(id)
    return true
  }

  providerFor(sessionId: string): ManagedDegradedPtyProvider {
    return this.routes.get(sessionId) ?? this.findExisting(sessionId) ?? this.fallback
  }

  providerForBinding(provenance: TerminalBindingProvenance): ManagedDegradedPtyProvider {
    if (provenance.kind === 'local-fallback') {
      return this.fallback
    }
    if (provenance.kind !== 'local-daemon') {
      throw new Error('Remote binding cannot be routed by the degraded local provider')
    }
    const adapter = this.daemonAdapters().find(
      (candidate) => candidate.protocolVersion === provenance.protocolVersion
    )
    if (!adapter) {
      throw new Error(`Daemon protocol ${provenance.protocolVersion} is not routed`)
    }
    return adapter
  }

  provenanceForSession(id: string): TerminalBindingProvenance {
    return this.provenanceFor(this.providerFor(id))
  }

  hasPty(id: string): boolean {
    const mapped = this.routes.get(id)
    if (mapped) {
      return mapped.hasPty?.(id) ?? true
    }
    return this.findExisting(id) !== null
  }

  sessionIdsFor(provider: ManagedDegradedPtyProvider): string[] {
    return [...this.routes]
      .filter(([, mappedProvider]) => mappedProvider === provider)
      .map(([id]) => id)
  }

  daemonAdapterFor(sessionId: string): DaemonPtyAdapter | null {
    const provider = this.routes.get(sessionId)
    return provider && this.daemonAdapters().includes(provider as DaemonPtyAdapter)
      ? (provider as DaemonPtyAdapter)
      : null
  }

  mutableMap(): Map<string, ManagedDegradedPtyProvider> {
    return this.routes
  }

  private findExisting(sessionId: string): ManagedDegradedPtyProvider | null {
    for (const provider of [this.fallback, ...this.daemonAdapters()]) {
      if (provider.hasPty?.(sessionId) === true) {
        this.routes.set(sessionId, provider)
        return provider
      }
    }
    return null
  }

  private provenanceFor(provider: ManagedDegradedPtyProvider): TerminalBindingProvenance {
    return provider === this.fallback
      ? { kind: 'local-fallback' }
      : (provider as DaemonPtyAdapter).getPtyBindingProvenance()
  }
}

function bindingMatches(
  left: TerminalBindingProvenance,
  right: TerminalBindingProvenance
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

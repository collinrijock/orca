import type { IPtyProvider, PtyBackgroundStreamEvent } from '../providers/types'
import type { PtyExitPayload } from '../providers/pty-exit-payload'
import type { TerminalBindingProvenance } from '../../shared/daemon-session-ownership'

type EventProvider = Pick<
  IPtyProvider,
  | 'getPtyBindingProvenance'
  | 'onBackgroundStreamEvent'
  | 'onData'
  | 'onExit'
  | 'onPtyBindingInventoryAvailable'
  | 'onReplay'
>

export class DegradedDaemonProviderEvents {
  private unsubscribers: (() => void)[] = []
  private dataListeners: ((payload: {
    id: string
    data: string
    sequenceChars?: number
  }) => void)[] = []
  private exitListeners: ((payload: PtyExitPayload) => void)[] = []

  constructor(private readonly providers: EventProvider[]) {
    for (const provider of providers) {
      this.unsubscribers.push(
        provider.onData((payload) => {
          for (const listener of this.dataListeners) {
            listener(payload)
          }
        }),
        provider.onExit((payload) => {
          // Why: preserve physical provenance until a healthy re-list proves an
          // identity-less exit did not race a replacement using the same id.
          for (const listener of this.exitListeners) {
            listener({
              ...payload,
              provenance: provider.getPtyBindingProvenance?.(payload.id) ?? payload.provenance
            })
          }
        })
      )
    }
  }

  onData(
    callback: (payload: { id: string; data: string; sequenceChars?: number }) => void
  ): () => void {
    this.dataListeners.push(callback)
    return () => {
      const index = this.dataListeners.indexOf(callback)
      if (index !== -1) {
        this.dataListeners.splice(index, 1)
      }
    }
  }

  onBackgroundStreamEvent(callback: (payload: PtyBackgroundStreamEvent) => void): () => void {
    const unsubscribes = this.providers.flatMap(
      (provider) => provider.onBackgroundStreamEvent?.(callback) ?? []
    )
    return () => {
      for (const unsubscribe of unsubscribes) {
        unsubscribe()
      }
    }
  }

  onReplay(callback: (payload: { id: string; data: string }) => void): () => void {
    const unsubscribes = this.providers.map((provider) => provider.onReplay(callback))
    let active = true
    const trackedUnsubscribe = (): void => {
      if (!active) {
        return
      }
      active = false
      const index = this.unsubscribers.indexOf(trackedUnsubscribe)
      if (index !== -1) {
        this.unsubscribers.splice(index, 1)
      }
      for (const unsubscribe of unsubscribes) {
        unsubscribe()
      }
    }
    this.unsubscribers.push(trackedUnsubscribe)
    return trackedUnsubscribe
  }

  onExit(callback: (payload: PtyExitPayload) => void): () => void {
    this.exitListeners.push(callback)
    return () => {
      const index = this.exitListeners.indexOf(callback)
      if (index !== -1) {
        this.exitListeners.splice(index, 1)
      }
    }
  }

  onPtyBindingInventoryAvailable(
    callback: (provenance: TerminalBindingProvenance) => void
  ): () => void {
    const unsubscribes = this.providers.flatMap(
      (provider) => provider.onPtyBindingInventoryAvailable?.(callback) ?? []
    )
    return () => {
      for (const unsubscribe of unsubscribes) {
        unsubscribe()
      }
    }
  }

  fanoutSyntheticExit(id: string, code: number, provenance?: TerminalBindingProvenance): void {
    // Why: listeners may unsubscribe while a synthetic restart exit is fanned out.
    for (const listener of this.exitListeners.slice()) {
      listener({ id, code, provenance, verifiedAbsent: true })
    }
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribers.splice(0)) {
      unsubscribe()
    }
  }
}

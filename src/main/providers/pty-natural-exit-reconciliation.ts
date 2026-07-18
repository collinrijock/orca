import type { TerminalBindingProvenance } from '../../shared/daemon-session-ownership'
import type { IPtyProvider } from './types'

export type PendingNaturalPtyExit = {
  id: string
  code: number
  provenance: TerminalBindingProvenance
}

export type NaturalPtyExitReconciliationSink = {
  getProvider: () => IPtyProvider
  finishVerifiedStop: (provider: IPtyProvider, exit: PendingNaturalPtyExit) => boolean
  deliverConfirmedExit: (exit: PendingNaturalPtyExit) => void
}

const RETRY_DELAYS_MS = [0, 50, 250, 1_000] as const

export class PtyNaturalExitReconciliation {
  private pending = new Map<string, PendingNaturalPtyExit>()
  private bursts = new Map<string, Promise<void>>()
  private wakeAfterBurst = new Set<string>()
  private explicitStopFences = new Map<string, number>()
  private sink: NaturalPtyExitReconciliationSink | null = null

  setSink(sink: NaturalPtyExitReconciliationSink): void {
    this.sink = sink
    this.wakeAll()
  }

  enqueue(exit: PendingNaturalPtyExit): void {
    const key = exitKey(exit.id, exit.provenance)
    this.pending.set(key, exit)
    if (this.explicitStopFences.has(key)) {
      return
    }
    this.wake(exit.provenance)
  }

  cancel(id: string, provenance: TerminalBindingProvenance): void {
    this.pending.delete(exitKey(id, provenance))
  }

  beginExplicitStop(id: string, provenance: TerminalBindingProvenance): void {
    const key = exitKey(id, provenance)
    this.explicitStopFences.set(key, (this.explicitStopFences.get(key) ?? 0) + 1)
  }

  completeExplicitStop(
    id: string,
    provenance: TerminalBindingProvenance
  ): PendingNaturalPtyExit | null {
    const key = exitKey(id, provenance)
    this.removeExplicitStopFence(key)
    const exit = this.pending.get(key) ?? null
    this.pending.delete(key)
    return exit
  }

  releaseExplicitStop(id: string, provenance: TerminalBindingProvenance): void {
    const key = exitKey(id, provenance)
    if (this.removeExplicitStopFence(key) && this.pending.has(key)) {
      // Why: failed explicit verification leaves the natural exit as the only
      // proof owner, so resume its bounded inventory reconciliation.
      this.wake(provenance)
    }
  }

  notifyInventoryAvailable(provenance: TerminalBindingProvenance): void {
    this.wake(provenance)
  }

  wakeAll(): void {
    const provenances = new Map<string, TerminalBindingProvenance>()
    for (const exit of this.pending.values()) {
      provenances.set(provenanceKey(exit.provenance), exit.provenance)
    }
    for (const provenance of provenances.values()) {
      this.wake(provenance)
    }
  }

  private wake(provenance: TerminalBindingProvenance): void {
    const key = provenanceKey(provenance)
    if (!this.sink || !this.hasActionablePendingProvenance(key)) {
      return
    }
    if (this.bursts.has(key)) {
      this.wakeAfterBurst.add(key)
      return
    }
    const burst = this.runBoundedBurst(key, provenance).finally(() => {
      this.bursts.delete(key)
      if (this.wakeAfterBurst.delete(key) && this.hasActionablePendingProvenance(key)) {
        this.wake(provenance)
      }
    })
    this.bursts.set(key, burst)
  }

  private async runBoundedBurst(key: string, provenance: TerminalBindingProvenance): Promise<void> {
    for (const delayMs of RETRY_DELAYS_MS) {
      if (!this.hasActionablePendingProvenance(key)) {
        return
      }
      if (delayMs > 0) {
        await backgroundDelay(delayMs)
      }
      if (await this.reconcileBatch(key, provenance)) {
        return
      }
    }
    // Why: unknown ownership stays durable but goes timer-free until a
    // successful inventory, provider rebind, or handler registration wakes it.
  }

  private async reconcileBatch(
    key: string,
    provenance: TerminalBindingProvenance
  ): Promise<boolean> {
    const sink = this.sink
    if (!sink) {
      return false
    }
    const provider = sink.getProvider()
    if (!provider.listProcessesForBinding) {
      return false
    }
    let liveIds: Set<string>
    try {
      const processes = await provider.listProcessesForBinding(provenance)
      liveIds = new Set(processes.map(({ id }) => id))
    } catch {
      return false
    }
    if (this.sink !== sink || sink.getProvider() !== provider) {
      // Why: a provider/window swap during the awaited inventory makes that
      // result stale; only the current sink may mutate ownership or deliver.
      return false
    }
    let allDecisionsSettled = true
    for (const [pendingKey, exit] of this.pending) {
      if (provenanceKey(exit.provenance) !== key) {
        continue
      }
      if (this.explicitStopFences.has(pendingKey)) {
        // Why: an explicit stop owns verification and delivery while fenced;
        // consuming its queued exit here could race route removal and lose it.
        continue
      }
      if (liveIds.has(exit.id)) {
        this.pending.delete(pendingKey)
        continue
      }
      let didFinish: boolean
      try {
        didFinish = sink.finishVerifiedStop(provider, exit)
      } catch {
        // Why: persistence failure cannot erase the only retained proof; the
        // next bounded attempt or healthy-inventory event retries it.
        allDecisionsSettled = false
        continue
      }
      this.pending.delete(pendingKey)
      if (didFinish) {
        try {
          sink.deliverConfirmedExit(exit)
        } catch (error) {
          // Why: ownership cleanup is already committed and delivery may have
          // partially run; contain the fault instead of retrying duplicates.
          console.error('[pty] Failed to deliver reconciled natural exit:', error)
        }
      }
    }
    return allDecisionsSettled
  }

  private hasActionablePendingProvenance(key: string): boolean {
    for (const [pendingKey, exit] of this.pending) {
      if (provenanceKey(exit.provenance) === key && !this.explicitStopFences.has(pendingKey)) {
        return true
      }
    }
    return false
  }

  private removeExplicitStopFence(key: string): boolean {
    const count = this.explicitStopFences.get(key)
    if (count === undefined) {
      return true
    }
    if (count > 1) {
      this.explicitStopFences.set(key, count - 1)
      return false
    }
    this.explicitStopFences.delete(key)
    return true
  }
}

function exitKey(id: string, provenance: TerminalBindingProvenance): string {
  return `${provenanceKey(provenance)}\0${id}`
}

function provenanceKey(provenance: TerminalBindingProvenance): string {
  return JSON.stringify(provenance)
}

function backgroundDelay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    timer.unref?.()
  })
}

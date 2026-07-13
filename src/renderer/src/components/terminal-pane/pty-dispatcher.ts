/**
 * Singleton PTY event dispatcher and eager buffer helpers.
 *
 * Why extracted: keeps pty-transport.ts under the 300-line limit while
 * co-locating the global handler maps that both the transport factory
 * and the eager-buffer reconnection logic share.
 */
import {
  clearProcessedPtyCharTotal,
  deliverPtyDataWithDeferredAck,
  exposeE2eTerminalPtyAckGate,
  getProcessedPtyCharTotals
} from './terminal-pty-ack-gate'
import {
  bufferPreHandlerPtyData,
  bufferPreHandlerPtyExit,
  clearPreHandlerPtyState
} from './pty-pre-handler-buffer'
import {
  clearReceivedPtyCharTotal,
  isPtyPushDeliveryBlackholed,
  recordPtyDataReceived,
  startTerminalDeliveryWatchdog
} from './terminal-delivery-watchdog'
import { recordTerminalFreezeBreadcrumb } from './terminal-freeze-breadcrumbs'
import { installTerminalFreezeReport } from './terminal-freeze-report'
import { ptyDataHandlers, ptyExitHandlers, ptyReplayHandlers } from './pty-primary-handler-registry'
import {
  getEagerPtyBufferHandle,
  hasEagerPtyBufferHandles,
  registerEagerPtyBufferState
} from './pty-eager-buffer'
import type { EagerPtyHandle } from './pty-eager-buffer'
import type { PtyDataMeta } from './pty-primary-handler-registry'

export {
  ptyDataHandlers,
  ptyExitHandlers,
  ptyReplayHandlers,
  ptyTeardownHandlers,
  restorePtyDataHandlersAfterFailedShutdown,
  unregisterPtyDataHandlers
} from './pty-primary-handler-registry'
export type { PtyDataHandlerShutdownSnapshot, PtyDataMeta } from './pty-primary-handler-registry'
export { getEagerPtyBufferHandle }
export type { EagerPtyHandle }

// ── Singleton PTY event dispatcher ───────────────────────────────────
// One global IPC listener per channel, routes events to transports by
// PTY ID. Eliminates the N-listener problem that triggers
// MaxListenersExceededWarning with many panes/tabs.

/** Sidecar subscriptions that observe PTY data without owning the primary
 *  handler. Used by features that need to react to the live byte stream
 *  (e.g. agent-paste-draft watching for DECSET 2004 / bracketed-paste-
 *  enable). Sidecars are invoked AFTER the primary handler so xterm rendering
 *  is never delayed by a side-effect-only watcher. Each Set entry is one
 *  active subscription; removal is by Set.delete inside the unsubscribe fn. */
export const ptyDataSidecars = new Map<string, Set<(data: string) => void>>()
const ptyExitSidecars = new Map<string, Set<(code: number) => void>>()
let ptyDispatcherAttached = false

let pushListenerUnsubscribes: (() => void)[] = []

/** Detach and freshly re-subscribe every push-channel listener. Called by the
 *  delivery watchdog on a confirmed wedge: if the listener was somehow
 *  detached this restores delivery outright; if the channel itself is dead
 *  it is a safe no-op (removeListener on a gone listener does nothing). */
export function reattachPtyDispatcherPushListeners(): void {
  recordTerminalFreezeBreadcrumb('push-listeners-reattach', {
    staleListenerCount: pushListenerUnsubscribes.length
  })
  const stale = pushListenerUnsubscribes
  pushListenerUnsubscribes = []
  for (const unsubscribe of stale) {
    unsubscribe()
  }
  attachPtyPushListeners()
}

export function ensurePtyDispatcher(): void {
  if (ptyDispatcherAttached) {
    return
  }
  ptyDispatcherAttached = true
  exposeE2eTerminalPtyAckGate()
  installTerminalFreezeReport()
  attachPtyPushListeners()
  startTerminalDeliveryWatchdog({
    reattachPushListeners: reattachPtyDispatcherPushListeners,
    hasAttachedPtys: () => ptyDataHandlers.size > 0 || hasEagerPtyBufferHandles()
  })
}

function attachPtyPushListeners(): void {
  const unsubscribes = pushListenerUnsubscribes
  unsubscribes.push(
    window.api.pty.onData((payload) => {
      // Why: e2e-only wedge simulation — the chunk vanishes exactly as in the
      // field failure: no receive count, no ACK credit, no handler dispatch.
      if (isPtyPushDeliveryBlackholed()) {
        return
      }
      handleDispatchedPtyData(payload)
    })
  )
  attachPtySecondaryPushListeners(unsubscribes)
}

function handleDispatchedPtyData(payload: {
  id: string
  data: string
  seq?: number
  rawLength?: number
  background?: boolean
  droppedOutput?: boolean
}): void {
  let meta: PtyDataMeta | undefined
  if (typeof payload.seq === 'number') {
    meta ??= {}
    meta.seq = payload.seq
  }
  if (typeof payload.rawLength === 'number') {
    meta ??= {}
    meta.rawLength = payload.rawLength
  }
  if (payload.background === true) {
    meta ??= {}
    meta.background = true
  }
  if (payload.droppedOutput === true) {
    meta ??= {}
    meta.droppedOutput = true
  }
  const chars = payload.rawLength ?? payload.data.length
  const dispatch = (): void => {
    const handler = ptyDataHandlers.get(payload.id)
    if (handler) {
      handler(payload.data, meta)
    } else {
      bufferPreHandlerPtyData(payload.id, payload.data, meta)
    }
    const sidecars = ptyDataSidecars.get(payload.id)
    if (sidecars && sidecars.size > 0) {
      // Why: snapshot the Set before iterating because watchers commonly
      // unsubscribe themselves on the very chunk that satisfies them
      // (e.g. agent-paste-draft resolves on DECSET 2004 and immediately
      // tears down). Iterating the live Set in that case can skip a
      // watcher or — if a watcher synchronously subscribes a sibling —
      // double-fire. The Set is never large (one watcher per active
      // ready-wait), so the array allocation is cheap.
      const snapshot = Array.from(sidecars)
      for (const watcher of snapshot) {
        watcher(payload.data)
      }
    }
  }
  recordPtyDataReceived(payload.id, chars)
  // Why deferred: main budgets renderer-bound output by bytes PARSED, not
  // bytes received. The handler's scheduler write claims this delivery's
  // credit and fires it when xterm consumes the bytes; deliveries that never
  // reach the scheduler (dropped, pre-mount eager buffer) settle at return —
  // a bad sidecar still cannot leave a PTY permanently backpressured.
  deliverPtyDataWithDeferredAck(payload.id, chars, dispatch)
}

function attachPtySecondaryPushListeners(unsubscribes: (() => void)[]): void {
  unsubscribes.push(
    window.api.pty.onReplay((payload) => {
      ptyReplayHandlers.get(payload.id)?.(payload.data)
    })
  )
  unsubscribes.push(
    window.api.pty.onExit((payload) => {
      // Why: main drops its delivery accounting for this pty on exit; drop the
      // cumulative totals too so a reused id restarts at zero on both sides.
      clearProcessedPtyCharTotal(payload.id)
      clearReceivedPtyCharTotal(payload.id)
      const handler = ptyExitHandlers.get(payload.id)
      if (handler) {
        clearPreHandlerPtyState(payload.id)
        handler(payload.code)
      } else {
        bufferPreHandlerPtyExit(payload.id, payload.code)
      }
      const sidecars = ptyExitSidecars.get(payload.id)
      if (sidecars && sidecars.size > 0) {
        const snapshot = Array.from(sidecars)
        ptyExitSidecars.delete(payload.id)
        for (const sidecar of snapshot) {
          sidecar(payload.code)
        }
      }
    })
  )
  // Why: main probes when delivery looks stuck on lost ACKs (data arriving
  // for a fully gated PTY). Replying with the cumulative processed totals
  // lets main reconcile verified state instead of resetting blindly.
  const unsubscribeResync = window.api.pty.onDeliveryResyncRequest?.((payload) => {
    window.api.pty.respondDeliveryResync?.({
      requestId: payload.requestId,
      processedCharsByPty: getProcessedPtyCharTotals()
    })
  })
  if (unsubscribeResync) {
    unsubscribes.push(unsubscribeResync)
  }
  // Why: tell main the pty:data listener is live now. Before this fires (fresh
  // load or post-reload boot window) main holds all sends — bytes sent into a
  // listener-less page are silently dropped yet counted in-flight, which
  // permanently pins the delivery gate. Fires once per page load.
  window.api.pty.rendererDispatcherReady?.()
}

export function subscribeToPtyExit(ptyId: string, watcher: (code: number) => void): () => void {
  ensurePtyDispatcher()
  let set = ptyExitSidecars.get(ptyId)
  if (!set) {
    set = new Set()
    ptyExitSidecars.set(ptyId, set)
  }
  set.add(watcher)
  return () => {
    const current = ptyExitSidecars.get(ptyId)
    if (!current) {
      return
    }
    current.delete(watcher)
    if (current.size === 0) {
      ptyExitSidecars.delete(ptyId)
    }
  }
}

export function registerEagerPtyBuffer(
  ptyId: string,
  onExit: (ptyId: string, code: number) => void
): EagerPtyHandle {
  ensurePtyDispatcher()
  return registerEagerPtyBufferState(ptyId, onExit)
}

import { clearPreHandlerPtyState, drainPreHandlerPtyData } from './pty-pre-handler-buffer'
import {
  getPtyPrimaryExitHandlerOwner,
  isPtyPrimaryDataHandlerOwnerCurrent,
  isPtyPrimaryExitHandlerOwnerCurrent,
  restorePtyPrimaryDataHandlerOwner,
  suspendPtyPrimaryDataHandlerOwner
} from './pty-primary-handler-admission'
import type { PtyPrimaryHandlerOwner } from './pty-primary-handler-admission'

export type PtyDataMeta = {
  seq?: number
  rawLength?: number
  background?: boolean
  /** Main dropped buffered output; the pane must repaint from main's snapshot. */
  droppedOutput?: boolean
}

export const ptyDataHandlers = new Map<string, (data: string, meta?: PtyDataMeta) => void>()
export const ptyReplayHandlers = new Map<string, (data: string) => void>()
export const ptyExitHandlers = new Map<string, (code: number) => void>()
export const ptyTeardownHandlers = new Map<string, () => void>()

export type PtyDataHandlerShutdownSnapshot = {
  ptyId: string
  dataOwner?: PtyPrimaryHandlerOwner
  exitOwner?: PtyPrimaryHandlerOwner
  dataHandler?: (data: string, meta?: PtyDataMeta) => void
  replayHandler?: (data: string) => void
  teardownHandler?: () => void
}

export function unregisterPtyDataHandlers(ptyIds: string[]): PtyDataHandlerShutdownSnapshot[] {
  const snapshots: PtyDataHandlerShutdownSnapshot[] = []
  for (const id of ptyIds) {
    snapshots.push({
      ptyId: id,
      dataOwner: suspendPtyPrimaryDataHandlerOwner(id),
      exitOwner: getPtyPrimaryExitHandlerOwner(id),
      dataHandler: ptyDataHandlers.get(id),
      replayHandler: ptyReplayHandlers.get(id),
      teardownHandler: ptyTeardownHandlers.get(id)
    })
    ptyDataHandlers.delete(id)
    ptyReplayHandlers.delete(id)
    ptyTeardownHandlers.get(id)?.()
    ptyTeardownHandlers.delete(id)
    clearPreHandlerPtyState(id)
  }
  return snapshots
}

export function restorePtyDataHandlersAfterFailedShutdown(
  snapshots: readonly PtyDataHandlerShutdownSnapshot[]
): void {
  for (const snapshot of snapshots) {
    const dataSlotsAvailable =
      (!snapshot.dataHandler || !ptyDataHandlers.has(snapshot.ptyId)) &&
      (!snapshot.replayHandler || !ptyReplayHandlers.has(snapshot.ptyId))
    if (
      dataSlotsAvailable &&
      (snapshot.dataHandler || snapshot.replayHandler) &&
      restorePtyPrimaryDataHandlerOwner(snapshot.ptyId, snapshot.dataOwner)
    ) {
      if (snapshot.dataHandler) {
        ptyDataHandlers.set(snapshot.ptyId, snapshot.dataHandler)
      }
      if (snapshot.replayHandler) {
        ptyReplayHandlers.set(snapshot.ptyId, snapshot.replayHandler)
      }
      if (snapshot.dataHandler) {
        drainPreHandlerPtyData(snapshot.ptyId, snapshot.dataHandler, () => {
          return (
            isPtyPrimaryDataHandlerOwnerCurrent(snapshot.ptyId, snapshot.dataOwner) &&
            ptyDataHandlers.get(snapshot.ptyId) === snapshot.dataHandler
          )
        })
      }
    }
    if (
      snapshot.teardownHandler &&
      !ptyTeardownHandlers.has(snapshot.ptyId) &&
      isPtyPrimaryExitHandlerOwnerCurrent(snapshot.ptyId, snapshot.exitOwner)
    ) {
      ptyTeardownHandlers.set(snapshot.ptyId, snapshot.teardownHandler)
    }
  }
}

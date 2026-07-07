// Why: a dirty tab restored from a workspace session carries edits based on
// disk content that may have changed while the app was closed (an agent write,
// a sync tool). The in-memory changed-on-disk mark does not survive restarts,
// so without this scan a resumed autosave would silently overwrite that newer
// content (issue #7265 follow-up). The scan re-derives the conflict from
// ground truth: it reads each restored dirty tab's file and compares the disk
// signature against the persisted edit baseline. Autosave is hard-suspended
// for those tabs (pendingDiskBaselineVerification, set at hydration) until a
// verification resolves — otherwise the read would merely race the autosave
// timer and a slow remote read would lose.
import type { StoreApi } from 'zustand'
import type { AppState } from '@/store'
import type { OpenFile } from '@/store/slices/editor'
import { getConnectionIdForFile } from '@/lib/connection-context'
import { readRuntimeFileContent } from '@/runtime/runtime-file-client'
import { settingsForRuntimeOwner } from '@/runtime/runtime-rpc-client'
import { canAutoSaveOpenFile } from './editor-autosave'
import { getDiskBaselineSignature } from './diff-content-signature'
import { trackExternalChangeConflictShown } from './editor-external-change-telemetry'

type AppStoreApi = Pick<StoreApi<AppState>, 'getState' | 'subscribe'>

// Why: SSH/runtime reads fail while the connection is still coming up after
// launch. Retry fast for the first minute, then keep probing slowly forever —
// giving up would either strand the tab's autosave suspension or lift it
// unverified right as the transport comes back up.
const VERIFY_RETRY_MS = 2_000
const VERIFY_SLOW_RETRY_MS = 15_000
const VERIFY_FAST_ATTEMPTS = 30

export function attachRestoredTabConflictScan(store: AppStoreApi): () => void {
  // Why: dedupes in-flight verifications; the store's pending flag is the
  // durable "needs verification" signal.
  const inFlightFileIds = new Set<string>()
  const attemptsByFileId = new Map<string, number>()
  const retryTimers = new Set<ReturnType<typeof setTimeout>>()
  let disposed = false

  const verify = async (file: OpenFile): Promise<void> => {
    try {
      const state = store.getState()
      const result = await readRuntimeFileContent({
        settings: settingsForRuntimeOwner(state.settings, file.runtimeEnvironmentId),
        filePath: file.filePath,
        relativePath: file.relativePath,
        worktreeId: file.worktreeId,
        connectionId: getConnectionIdForFile(file.worktreeId, file.filePath) ?? undefined
      })
      if (disposed) {
        return
      }
      const liveFile = store.getState().openFiles.find((f) => f.id === file.id)
      if (!liveFile) {
        return
      }
      // Why: verification resolved — lift the autosave suspension regardless
      // of outcome. If a save raced the read, the save already re-baselined
      // and cleared the flag itself; wasPending distinguishes that case.
      const wasPending = liveFile.pendingDiskBaselineVerification === true
      store.getState().clearPendingDiskBaselineVerification(file.id)
      if (
        !wasPending ||
        result.isBinary ||
        !liveFile.isDirty ||
        liveFile.externalMutation === 'changed'
      ) {
        return
      }
      if (getDiskBaselineSignature(result.content) !== file.lastKnownDiskSignature) {
        trackExternalChangeConflictShown(liveFile, {
          connectionId: getConnectionIdForFile(file.worktreeId, file.filePath) ?? undefined,
          origin: 'restore'
        })
        store.getState().setExternalMutation(file.id, 'changed')
      }
    } catch {
      if (disposed) {
        return
      }
      const attempts = (attemptsByFileId.get(file.id) ?? 0) + 1
      attemptsByFileId.set(file.id, attempts)
      const timer = setTimeout(
        () => {
          retryTimers.delete(timer)
          inFlightFileIds.delete(file.id)
          scan()
        },
        attempts < VERIFY_FAST_ATTEMPTS ? VERIFY_RETRY_MS : VERIFY_SLOW_RETRY_MS
      )
      retryTimers.add(timer)
      return
    }
    inFlightFileIds.delete(file.id)
  }

  const scan = (): void => {
    if (disposed) {
      return
    }
    for (const file of store.getState().openFiles) {
      if (
        !file.pendingDiskBaselineVerification ||
        !file.isDirty ||
        !file.lastKnownDiskSignature ||
        file.externalMutation === 'changed' ||
        !canAutoSaveOpenFile(file) ||
        inFlightFileIds.has(file.id)
      ) {
        continue
      }
      inFlightFileIds.add(file.id)
      void verify(file)
    }
  }

  let previousOpenFiles = store.getState().openFiles
  const unsubscribe = store.subscribe(() => {
    const nextOpenFiles = store.getState().openFiles
    if (nextOpenFiles === previousOpenFiles) {
      return
    }
    previousOpenFiles = nextOpenFiles
    scan()
  })
  scan()

  return () => {
    disposed = true
    unsubscribe()
    for (const timer of retryTimers) {
      clearTimeout(timer)
    }
    retryTimers.clear()
  }
}

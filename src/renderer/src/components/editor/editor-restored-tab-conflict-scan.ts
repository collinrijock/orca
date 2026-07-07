// Why: a dirty tab restored from a workspace session carries edits based on
// disk content that may have changed while the app was closed (an agent write,
// a sync tool). The in-memory changed-on-disk mark does not survive restarts,
// so without this scan a resumed autosave would silently overwrite that newer
// content (issue #7265 follow-up). The scan re-derives the conflict from
// ground truth: it reads each restored dirty tab's file once and compares the
// disk signature against the persisted edit baseline.
import type { StoreApi } from 'zustand'
import type { AppState } from '@/store'
import type { OpenFile } from '@/store/slices/editor'
import { getConnectionIdForFile } from '@/lib/connection-context'
import { readRuntimeFileContent } from '@/runtime/runtime-file-client'
import { settingsForRuntimeOwner } from '@/runtime/runtime-rpc-client'
import { canAutoSaveOpenFile } from './editor-autosave'
import { getDiffContentSignature } from './diff-content-signature'
import { trackExternalChangeConflictShown } from './editor-external-change-telemetry'

type AppStoreApi = Pick<StoreApi<AppState>, 'getState' | 'subscribe'>

// Why: SSH/runtime reads fail while the connection is still coming up after
// launch; retry for a bounded window instead of giving up on the first tick.
// A tab that stays unverified is left unmarked — the paired write would fail
// over the same dead transport, so autosave cannot clobber it either.
const VERIFY_RETRY_MS = 2_000
const VERIFY_MAX_ATTEMPTS = 30

export function attachRestoredTabConflictScan(store: AppStoreApi): () => void {
  // Why: one verification per fileId per session — later disk changes are the
  // live watcher's job, and re-reading on every store tick would turn this
  // into a poller.
  const handledFileIds = new Set<string>()
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
      if (disposed || result.isBinary) {
        return
      }
      const liveFile = store.getState().openFiles.find((f) => f.id === file.id)
      // Why: the tab may have been saved, reloaded, or closed while the read
      // was in flight — only a still-dirty tab holds edits worth protecting.
      if (!liveFile || !liveFile.isDirty || liveFile.externalMutation === 'changed') {
        return
      }
      if (getDiffContentSignature(result.content) !== file.lastKnownDiskSignature) {
        trackExternalChangeConflictShown(liveFile, {
          connectionId: getConnectionIdForFile(file.worktreeId, file.filePath) ?? undefined,
          origin: 'restore'
        })
        store.getState().setExternalMutation(file.id, 'changed')
      }
    } catch {
      const attempts = (attemptsByFileId.get(file.id) ?? 0) + 1
      attemptsByFileId.set(file.id, attempts)
      if (disposed || attempts >= VERIFY_MAX_ATTEMPTS) {
        return
      }
      const timer = setTimeout(() => {
        retryTimers.delete(timer)
        handledFileIds.delete(file.id)
        scan()
      }, VERIFY_RETRY_MS)
      retryTimers.add(timer)
    }
  }

  const scan = (): void => {
    if (disposed) {
      return
    }
    for (const file of store.getState().openFiles) {
      if (
        !file.isDirty ||
        !file.lastKnownDiskSignature ||
        file.externalMutation === 'changed' ||
        !canAutoSaveOpenFile(file) ||
        handledFileIds.has(file.id)
      ) {
        continue
      }
      handledFileIds.add(file.id)
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

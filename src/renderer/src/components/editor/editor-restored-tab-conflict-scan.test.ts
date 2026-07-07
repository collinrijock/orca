import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { createEditorSlice } from '@/store/slices/editor'
import type { AppState } from '@/store'
import { attachRestoredTabConflictScan } from './editor-restored-tab-conflict-scan'
import { getDiffContentSignature } from './diff-content-signature'

const mocks = vi.hoisted(() => ({
  readRuntimeFileContent: vi.fn(),
  getConnectionIdForFile: vi.fn()
}))

vi.mock('@/runtime/runtime-file-client', () => ({
  readRuntimeFileContent: mocks.readRuntimeFileContent
}))
vi.mock('@/runtime/runtime-rpc-client', () => ({
  settingsForRuntimeOwner: () => null
}))
vi.mock('@/lib/connection-context', () => ({
  getConnectionIdForFile: mocks.getConnectionIdForFile
}))

function createEditorStore(): StoreApi<AppState> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createStore<any>()((...args: any[]) => ({
    settings: {},
    ...createEditorSlice(...(args as Parameters<typeof createEditorSlice>))
  })) as unknown as StoreApi<AppState>
}

function openRestoredDirtyTab(
  store: StoreApi<AppState>,
  filePath: string,
  baselineContent: string
): void {
  store.getState().openFile({
    filePath,
    relativePath: filePath.slice(1),
    worktreeId: 'wt-1',
    language: 'typescript',
    mode: 'edit'
  })
  store.getState().setEditorDraft(filePath, 'restored draft')
  store.getState().markFileDirty(filePath, true)
  store.getState().setLastKnownDiskSignature(filePath, getDiffContentSignature(baselineContent))
}

describe('attachRestoredTabConflictScan', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.readRuntimeFileContent.mockReset()
    mocks.getConnectionIdForFile.mockReset()
    mocks.getConnectionIdForFile.mockReturnValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('marks a restored dirty tab whose file changed while the app was closed', async () => {
    mocks.readRuntimeFileContent.mockResolvedValue({
      content: 'agent rewrote this offline',
      isBinary: false
    })
    const store = createEditorStore()
    openRestoredDirtyTab(store, '/repo/file.ts', 'original baseline')

    const detach = attachRestoredTabConflictScan(store)
    try {
      await vi.advanceTimersByTimeAsync(10)
      expect(store.getState().openFiles[0]?.externalMutation).toBe('changed')
    } finally {
      detach()
    }
  })

  it('leaves a restored dirty tab unmarked when disk still matches its baseline', async () => {
    mocks.readRuntimeFileContent.mockResolvedValue({
      content: 'original baseline',
      isBinary: false
    })
    const store = createEditorStore()
    openRestoredDirtyTab(store, '/repo/file.ts', 'original baseline')

    const detach = attachRestoredTabConflictScan(store)
    try {
      await vi.advanceTimersByTimeAsync(10)
      expect(store.getState().openFiles[0]?.externalMutation).toBeUndefined()
      expect(mocks.readRuntimeFileContent).toHaveBeenCalledTimes(1)
    } finally {
      detach()
    }
  })

  it('does not read files for clean tabs or tabs without a baseline', async () => {
    const store = createEditorStore()
    store.getState().openFile({
      filePath: '/repo/clean.ts',
      relativePath: 'clean.ts',
      worktreeId: 'wt-1',
      language: 'typescript',
      mode: 'edit'
    })
    store.getState().openFile({
      filePath: '/repo/dirty-no-baseline.ts',
      relativePath: 'dirty-no-baseline.ts',
      worktreeId: 'wt-1',
      language: 'typescript',
      mode: 'edit'
    })
    store.getState().setEditorDraft('/repo/dirty-no-baseline.ts', 'draft')
    store.getState().markFileDirty('/repo/dirty-no-baseline.ts', true)

    const detach = attachRestoredTabConflictScan(store)
    try {
      await vi.advanceTimersByTimeAsync(10)
      expect(mocks.readRuntimeFileContent).not.toHaveBeenCalled()
    } finally {
      detach()
    }
  })

  it('retries a failed read and marks once the file becomes readable', async () => {
    // Why: SSH/runtime connections come up after launch; the first reads fail.
    mocks.readRuntimeFileContent
      .mockRejectedValueOnce(new Error('connection not ready'))
      .mockResolvedValue({ content: 'agent rewrote this offline', isBinary: false })
    const store = createEditorStore()
    openRestoredDirtyTab(store, '/repo/file.ts', 'original baseline')

    const detach = attachRestoredTabConflictScan(store)
    try {
      await vi.advanceTimersByTimeAsync(10)
      expect(store.getState().openFiles[0]?.externalMutation).toBeUndefined()
      await vi.advanceTimersByTimeAsync(2_100)
      expect(store.getState().openFiles[0]?.externalMutation).toBe('changed')
    } finally {
      detach()
    }
  })

  it('does not mark a tab that was saved while the read was in flight', async () => {
    let resolveRead: (value: { content: string; isBinary: boolean }) => void = () => {}
    mocks.readRuntimeFileContent.mockReturnValue(
      new Promise((resolve) => {
        resolveRead = resolve
      })
    )
    const store = createEditorStore()
    openRestoredDirtyTab(store, '/repo/file.ts', 'original baseline')

    const detach = attachRestoredTabConflictScan(store)
    try {
      store.getState().markFileDirty('/repo/file.ts', false)
      resolveRead({ content: 'agent rewrote this offline', isBinary: false })
      await vi.advanceTimersByTimeAsync(10)
      expect(store.getState().openFiles[0]?.externalMutation).toBeUndefined()
    } finally {
      detach()
    }
  })
})

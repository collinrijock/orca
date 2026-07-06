import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenFile } from '@/store/slices/editor'
import {
  ExternalFileChangeBanner,
  keepTabEditsOverExternalChange,
  reloadTabContentFromDisk
} from './ExternalFileChangeBanner'
import { useAppStore } from '@/store'

vi.mock('@/store', () => ({
  useAppStore: {
    getState: vi.fn()
  }
}))

const file = {
  id: 'file-1',
  filePath: '/repo/notes.md',
  relativePath: 'notes.md',
  worktreeId: 'wt-1',
  mode: 'edit',
  isDirty: true,
  externalMutation: 'changed'
} as OpenFile

describe('ExternalFileChangeBanner', () => {
  const clearEditorDraft = vi.fn()
  const markFileDirty = vi.fn()
  const setExternalMutation = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useAppStore.getState).mockReturnValue({
      clearEditorDraft,
      markFileDirty,
      setExternalMutation
    } as never)
  })

  it('renders the overwrite warning, both actions, and an alert role', () => {
    const html = renderToStaticMarkup(
      <ExternalFileChangeBanner file={file} reloadContent={vi.fn()} />
    )
    expect(html).toContain('role="alert"')
    expect(html).toContain('changed on disk')
    expect(html).toContain('Saving will overwrite')
    expect(html).toContain('Reload from Disk')
    expect(html).toContain('Keep My Edits')
  })

  it('reload clears the draft, dirty flag, and mark before refetching content', () => {
    const calls: string[] = []
    clearEditorDraft.mockImplementation(() => calls.push('clearEditorDraft'))
    markFileDirty.mockImplementation(() => calls.push('markFileDirty'))
    setExternalMutation.mockImplementation(() => calls.push('setExternalMutation'))
    const reloadContent = vi.fn(() => calls.push('reloadContent'))

    reloadTabContentFromDisk(file, reloadContent)

    expect(clearEditorDraft).toHaveBeenCalledWith('file-1')
    expect(markFileDirty).toHaveBeenCalledWith('file-1', false)
    expect(setExternalMutation).toHaveBeenCalledWith('file-1', null)
    expect(reloadContent).toHaveBeenCalledWith(file)
    // Why: the draft shadows loaded content (editBuffers ?? fileContents), so
    // the refetch must come last or the stale unsaved text stays visible.
    expect(calls).toEqual([
      'clearEditorDraft',
      'markFileDirty',
      'setExternalMutation',
      'reloadContent'
    ])
  })

  it('keep-my-edits only clears the changed-on-disk mark', () => {
    keepTabEditsOverExternalChange('file-1')

    expect(setExternalMutation).toHaveBeenCalledWith('file-1', null)
    expect(clearEditorDraft).not.toHaveBeenCalled()
    expect(markFileDirty).not.toHaveBeenCalled()
  })
})

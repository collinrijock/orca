import type { AppState } from '../store/types'

const EDITOR_SESSION_CONTENT_TYPES = new Set(['editor', 'diff', 'conflict-review', 'check-details'])

export function closeMobileSessionTabInStore(
  store: Pick<AppState, 'unifiedTabsByWorktree' | 'openFiles' | 'closeFile' | 'closeUnifiedTab'>,
  worktreeId: string,
  tabId: string
): boolean {
  const worktreeTabs = store.unifiedTabsByWorktree[worktreeId] ?? []
  const unifiedTab = worktreeTabs.find((tab) => tab.id === tabId || tab.entityId === tabId)
  if (unifiedTab && EDITOR_SESSION_CONTENT_TYPES.has(unifiedTab.contentType)) {
    // Why: split copies (copyUnifiedTabToGroup) share one entityId. closeFile
    // removes the file from openFiles and closes only the first matching unified
    // tab, so it would tear down BOTH copies — and the wrong one first. Mirror
    // the desktop reference-counting guard (closeEditorIfUnreferenced): when
    // another editor tab still references this entityId, close only the targeted
    // copy and leave the shared file (and the other split) intact.
    const hasOtherReference = worktreeTabs.some(
      (tab) =>
        tab.id !== unifiedTab.id &&
        tab.entityId === unifiedTab.entityId &&
        EDITOR_SESSION_CONTENT_TYPES.has(tab.contentType)
    )
    if (hasOtherReference) {
      return store.closeUnifiedTab(unifiedTab.id) !== null
    }
    store.closeFile(unifiedTab.entityId)
    return true
  }

  const fallbackFile = store.openFiles.find(
    (file) => file.worktreeId === worktreeId && file.id === tabId
  )
  if (fallbackFile) {
    // Why: mobile may receive fallback file-id tabs from openFiles after the
    // unified tab wrapper has already closed; close the source file too.
    store.closeFile(fallbackFile.id)
    return true
  }

  return store.closeUnifiedTab(tabId) !== null
}

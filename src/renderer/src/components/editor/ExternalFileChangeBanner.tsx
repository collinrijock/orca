import React from 'react'
import { TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import type { OpenFile } from '@/store/slices/editor'

// Why: when an external process (usually an agent) rewrites a file while the
// tab holds unsaved edits, the reload pipeline preserves the buffer and marks
// the tab externalMutation='changed' (issue #7265). This banner is the
// recovery path — without it the tab is silently stale until close/reopen and
// the next save clobbers the newer disk content unannounced.
export function ExternalFileChangeBanner({
  file,
  reloadFileContent
}: {
  file: OpenFile
  reloadFileContent: (file: OpenFile) => void
}): React.JSX.Element {
  const handleReload = (): void => {
    const state = useAppStore.getState()
    // Why: drop the draft before reloading — the buffer shadows loaded
    // content (editBuffers ?? fileContents), so a reload alone would keep
    // showing the stale unsaved text.
    state.clearEditorDraft(file.id)
    state.markFileDirty(file.id, false)
    state.setExternalMutation(file.id, null)
    reloadFileContent(file)
  }

  const handleKeepEdits = (): void => {
    useAppStore.getState().setExternalMutation(file.id, null)
  }

  return (
    <div className="border-b border-amber-500/20 bg-amber-500/10 px-4 py-2 text-xs">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <TriangleAlert className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <span className="min-w-0 truncate font-medium text-foreground">
            {translate(
              'auto.components.editor.ExternalFileChangeBanner.7c41e90d12',
              'This file changed on disk while you have unsaved edits. Saving will overwrite the newer disk content.'
            )}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button type="button" size="xs" variant="outline" onClick={handleReload}>
            {translate(
              'auto.components.editor.ExternalFileChangeBanner.3fa2b8d417',
              'Reload from Disk'
            )}
          </Button>
          <Button type="button" size="xs" variant="ghost" onClick={handleKeepEdits}>
            {translate(
              'auto.components.editor.ExternalFileChangeBanner.a95d02c644',
              'Keep My Edits'
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

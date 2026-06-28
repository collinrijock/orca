import type { Editor } from '@tiptap/react'
import { handleRichMarkdownImagePaste } from './rich-markdown-paste-image'
import { handleRichMarkdownFilesystemPathPaste } from './rich-markdown-path-paste'
import { handleRichMarkdownLargeTextPaste } from './rich-markdown-large-text-paste'

export type RichMarkdownPasteHandlerArgs = {
  editor: Editor | null
  event: ClipboardEvent
  filePath: string
  worktreeId: string
  runtimeEnvironmentId?: string | null
}

export function handleRichMarkdownPaste({
  editor,
  event,
  filePath,
  worktreeId,
  runtimeEnvironmentId
}: RichMarkdownPasteHandlerArgs): boolean {
  if (
    handleRichMarkdownImagePaste({
      editor,
      event,
      filePath,
      worktreeId,
      runtimeEnvironmentId
    })
  ) {
    return true
  }

  // Why: must run before the Link extension's paste plugins so a bare path is
  // never autolinked into a broken markdown link (e.g. [CLAUDE.md](http://CLAUDE.md)).
  if (handleRichMarkdownFilesystemPathPaste(editor, event)) {
    return true
  }

  return handleRichMarkdownLargeTextPaste(editor, event)
}

import type { Editor } from '@tiptap/react'
import { getLinkBubblePosition, type LinkBubbleState } from './RichMarkdownLinkBubble'

export function handleRichMarkdownLinkShortcut({
  editor,
  event,
  isEditing,
  isMac,
  root,
  setEditing,
  setLinkBubble
}: {
  editor: Editor | null
  event: KeyboardEvent
  isEditing: boolean
  isMac: boolean
  root: HTMLElement | null
  setEditing: (editing: boolean) => void
  setLinkBubble: (bubble: LinkBubbleState | null) => void
}): boolean {
  const modifier = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
  if (!modifier || event.key.toLowerCase() !== 'k') {
    return false
  }
  event.preventDefault()
  if (!editor) {
    return true
  }
  if (isEditing) {
    setEditing(false)
    if (!editor.isActive('link')) {
      setLinkBubble(null)
    }
    editor.commands.focus()
    return true
  }
  const position = getLinkBubblePosition(editor, root)
  if (position) {
    const href = editor.isActive('link') ? String(editor.getAttributes('link').href ?? '') : ''
    setLinkBubble({
      kind: 'markdown',
      href,
      openEnabled: Boolean(href),
      copyEnabled: Boolean(href),
      ...position
    })
    setEditing(true)
  }
  return true
}

// @vitest-environment happy-dom

// Repro harness for issue #8075: "Markdown editor does not support numeric
// superscript footnotes" — inline HTML like `<sup><a href="...">[12]</a></sup>`.
//
// VERDICT: NOT REPRODUCED on the current tree. PR #8307 (feat(markdown): support
// HTML superscript links) added a first-class rich-Markdown node for exactly this
// syntax, and production wires it on (`htmlSuperscriptLinks: true` in
// useRichMarkdownEditorInstance.ts:15 and rich-markdown-editor-config.ts:132).
//
// This test imports the REAL rich-Markdown pipeline with the SAME flag production
// uses and asserts the CORRECT (fixed) behavior: the reported fragment is parsed
// into a `richMarkdownHtmlSuperscriptLink` atom, the visible `[12]` label + href
// are recovered, and the authored Markdown round-trips byte-for-byte.

import { Editor } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { encodeRawMarkdownHtmlForRichEditor } from './raw-markdown-html'
import { createRichMarkdownExtensions } from './rich-markdown-extensions'
import { createRichMarkdownEditorCodec } from './rich-markdown-source-transport'
import { createRichMarkdownHtmlSuperscriptLinkContext } from './rich-markdown-html-superscript-link-context'

const TEST_KEY = '0123456789abcdef0123456789abcdef'

// Mirrors the production wiring: htmlSuperscriptLinks enabled, same as
// useRichMarkdownEditorInstance.ts.
function createProductionLikeEditor(markdown: string): Editor {
  const codec = createRichMarkdownEditorCodec(TEST_KEY)
  const context = createRichMarkdownHtmlSuperscriptLinkContext({
    sourceFilePath: '/repo/README.md',
    worktreeId: 'worktree-1',
    worktreeRoot: '/repo',
    sourceOwner: { kind: 'local' }
  })
  return new Editor({
    extensions: createRichMarkdownExtensions({
      codec,
      htmlSuperscriptLinks: true,
      htmlSuperscriptLinkContext: context
    }),
    content: encodeRawMarkdownHtmlForRichEditor(markdown, codec, { htmlSuperscriptLinks: true }),
    contentType: 'markdown'
  })
}

function nodeNames(editor: Editor): string[] {
  const names: string[] = []
  editor.state.doc.descendants((node) => {
    names.push(node.type.name)
  })
  return names
}

describe('issue #8075 — numeric superscript footnote in the Markdown editor', () => {
  // The exact syntax pasted in the issue report.
  const reported = '<sup><a href="https://www.sci-gz.com/jtyw/jr/226.html">[12]</a></sup>'

  it('renders the reported <sup><a>[12]</a></sup> footnote as a citation atom (bug is FIXED)', () => {
    const editor = createProductionLikeEditor(`研究结果${reported}。`)
    try {
      // FIXED behavior: the fragment is recognized as a first-class citation node.
      // Before PR #8307 the editor did not support this and left it as inert text.
      expect(nodeNames(editor)).toContain('richMarkdownHtmlSuperscriptLink')

      const citation = editor.state.doc.firstChild?.child(1)
      expect(citation?.attrs).toMatchObject({
        source: reported,
        href: 'https://www.sci-gz.com/jtyw/jr/226.html',
        label: '[12]',
        title: null
      })

      // Authored Markdown is preserved byte-for-byte on serialize.
      expect(editor.getMarkdown()).toBe(`研究结果${reported}。`)
    } finally {
      editor.destroy()
    }
  })
})

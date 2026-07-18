import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import TabDragPreview from './TabDragPreview'
import type { TabDragItemData } from '../tab-group/useTabDragSplit'

function terminalDrag(overrides: Partial<TabDragItemData> = {}): TabDragItemData {
  return {
    kind: 'tab',
    worktreeId: 'wt-1',
    groupId: 'group-1',
    unifiedTabId: 'unified-1',
    visibleTabId: 'terminal-1',
    tabType: 'terminal',
    label: 'Build shell',
    ...overrides
  }
}

describe('TabDragPreview', () => {
  it('carries shell and custom profile accent into the active-tab preview', () => {
    const markup = renderToStaticMarkup(
      <TabDragPreview drag={terminalDrag({ shell: '/bin/fish', color: '#a855f7' })} />
    )

    expect(markup).toContain('data-drag-preview-shell="/bin/fish"')
    expect(markup).toContain('data-shell-identity="fish"')
    expect(markup).toContain('--tab-accent:#a855f7')
    expect(markup).toContain('bg-[var(--tab-accent,var(--primary))]')
    expect(markup).toContain('shadow-sm')
    expect(markup).not.toContain('shadow-md')
  })

  it('keeps agent identity ahead of shell identity', () => {
    const markup = renderToStaticMarkup(
      <TabDragPreview drag={terminalDrag({ agent: 'codex', shell: '/bin/zsh' })} />
    )

    expect(markup).toContain('data-drag-preview-agent="codex"')
    expect(markup).not.toContain('data-shell-identity')
  })
})

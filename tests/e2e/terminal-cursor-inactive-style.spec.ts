import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import {
  splitActiveTerminalPane,
  waitForActiveTerminalManager,
  waitForPaneCount
} from './helpers/terminal'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'

type InactiveCursorRender = {
  cursorStyle: unknown
  cursorInactiveStyle: unknown
  cursorClassName: string
}

type XtermCursorInactiveStyle = 'outline' | 'block' | 'bar' | 'underline' | 'none'

async function placeInactiveCursorOverGlyph(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = window.__store
    if (!store) {
      throw new Error('window.__store is not available')
    }
    const state = store.getState()
    const worktreeId = state.activeWorktreeId
    const tabId = worktreeId
      ? (state.activeTabIdByWorktree?.[worktreeId] ?? state.activeTabId)
      : state.activeTabId
    if (!tabId) {
      throw new Error('No active terminal tab')
    }
    const manager = window.__paneManagers?.get(tabId)
    if (!manager) {
      throw new Error('Active terminal PaneManager is not mounted')
    }
    const panes = manager.getPanes?.() ?? []
    const activePane = manager.getActivePane?.() ?? panes.at(-1) ?? null
    const inactivePane = panes.find((pane) => pane.id !== activePane?.id) ?? null
    if (!inactivePane || !activePane) {
      throw new Error('Need a split inactive pane to position the cursor')
    }

    manager.setActivePane(activePane.id, { focus: true })
    inactivePane.terminal.options.cursorBlink = false
    const input = 'Summarize recent commits'
    // Why: Codex-style prompt editors leave the terminal cursor over the
    // current glyph; xterm's inactive outline then appears as duplicate bars.
    inactivePane.terminal.write(`\r\n› ${input}\x1b[${input.length}D`)
    inactivePane.terminal.refresh(0, inactivePane.terminal.rows - 1)
  })
}

async function renderInactiveCursor(
  page: Page,
  forcedInactiveStyle?: XtermCursorInactiveStyle
): Promise<InactiveCursorRender> {
  return page.evaluate(async (forcedInactiveStyle) => {
    const store = window.__store
    if (!store) {
      throw new Error('window.__store is not available')
    }
    const state = store.getState()
    const worktreeId = state.activeWorktreeId
    const tabId = worktreeId
      ? (state.activeTabIdByWorktree?.[worktreeId] ?? state.activeTabId)
      : state.activeTabId
    if (!tabId) {
      throw new Error('No active terminal tab')
    }
    const manager = window.__paneManagers?.get(tabId)
    if (!manager) {
      throw new Error('Active terminal PaneManager is not mounted')
    }
    const panes = manager.getPanes?.() ?? []
    const activePane = manager.getActivePane?.() ?? panes.at(-1) ?? null
    const inactivePane = panes.find((pane) => pane.id !== activePane?.id) ?? null
    if (!inactivePane || !activePane) {
      throw new Error('Need a split inactive pane to inspect cursor rendering')
    }

    manager.setActivePane(activePane.id, { focus: true })
    if (forcedInactiveStyle) {
      inactivePane.terminal.options.cursorInactiveStyle = forcedInactiveStyle
    }
    inactivePane.terminal.refresh(0, inactivePane.terminal.rows - 1)
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))

    const cursor = inactivePane.container.querySelector<HTMLElement>('.xterm-cursor')
    return {
      cursorStyle: inactivePane.terminal.options.cursorStyle,
      cursorInactiveStyle: inactivePane.terminal.options.cursorInactiveStyle,
      cursorClassName:
        cursor?.className ??
        `(canvas renderer: ${inactivePane.terminal.options.cursorInactiveStyle})`
    }
  }, forcedInactiveStyle)
}

test.describe('Terminal inactive cursor rendering', () => {
  test.beforeEach(async ({ orcaPage }) => {
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
    await ensureTerminalVisible(orcaPage)
    await waitForActiveTerminalManager(orcaPage, 30_000)
    await waitForPaneCount(orcaPage, 1, 30_000)
  })

  test('keeps an unfocused bar cursor rendered as a bar, not an outline box', async ({
    orcaPage
  }) => {
    await splitActiveTerminalPane(orcaPage, 'vertical')
    await waitForPaneCount(orcaPage, 2)
    await placeInactiveCursorOverGlyph(orcaPage)

    const fixedBehavior = await renderInactiveCursor(orcaPage)
    expect(fixedBehavior.cursorStyle).toBe('bar')
    expect(fixedBehavior.cursorInactiveStyle).toBe('bar')
    expect(fixedBehavior.cursorClassName).toContain('bar')
    expect(fixedBehavior.cursorClassName).not.toContain('xterm-cursor-outline')

    const oldBehavior = await renderInactiveCursor(orcaPage, 'outline')
    expect(oldBehavior.cursorStyle).toBe('bar')
    expect(oldBehavior.cursorClassName).toContain('outline')
  })
})

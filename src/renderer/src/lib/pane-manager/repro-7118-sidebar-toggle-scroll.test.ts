import { describe, expect, it, vi } from 'vitest'
import { safeFit } from './pane-tree-ops'
import type { ManagedPaneInternal } from './pane-manager-types'
import { markTerminalPinnedViewport } from './terminal-scroll-intent'

// Repro for issue #7118: "Opening or closing sidebar will reset terminal scroll
// all the way to the top." Reported against v1.4.117.0.
//
// Toggling the sidebar changes the terminal container width. That width change
// is picked up by the pane's ResizeObserver (see pane-fit-resize-observer.ts),
// which calls the real `safeFit()` in pane-fit.ts. When xterm's FitAddon.fit()
// reflows the grid it renumbers/resets the native viewport to the top — which is
// exactly the "scroll jumped to top" symptom the user filed.
//
// This test drives the SAME real product path (safeFit + the real
// terminal-scroll-intent machinery) with a user who has scrolled UP (a pinned
// viewport). It simulates the sidebar toggle by making the proposed grid differ
// from the current grid (so fit actually runs) and having fit clobber the
// viewport to the top, then asserts what safeFit does with the scroll position.
//
// RESULT ON CURRENT TREE: safeFit captures the pinned scroll BEFORE fit and
// restores it AFTER, so the viewport is preserved. The bug does NOT reproduce.
// If this bug were still present, `viewportY` would be left at 0 (top) and
// `scrollToLine(42)` would never be called.

function createPane(): ManagedPaneInternal {
  const leafId = '11111111-1111-4111-8111-111111111111' as never
  const fit = vi.fn()
  // Before the toggle the terminal is 120 cols; the sidebar toggle shrinks the
  // usable width so the fresh proposed grid is 100 cols -> fit will actually run.
  const proposeDimensions = vi.fn(() => ({ cols: 100, rows: 32 }))
  const terminal = {
    cols: 120,
    rows: 32,
    element: {} as HTMLElement,
    resize: vi.fn((cols: number, rows: number) => {
      terminal.cols = cols
      terminal.rows = rows
    }),
    refresh: vi.fn(),
    buffer: {
      active: {
        type: 'normal',
        viewportY: 0,
        baseY: 0,
        getLine: vi.fn(() => ({ translateToString: () => '' }))
      }
    },
    scrollToBottom: vi.fn(),
    scrollToLine: vi.fn((line: number) => {
      terminal.buffer.active.viewportY = line
    }),
    scrollLines: vi.fn()
  }
  return {
    id: 1,
    leafId,
    stablePaneId: leafId,
    terminal: terminal as never,
    container: {
      dataset: {},
      getBoundingClientRect: () =>
        ({ width: 800, height: 400, top: 0, left: 0, right: 800, bottom: 400 }) as DOMRect
    } as never,
    xtermContainer: {} as never,
    linkTooltip: {} as never,
    terminalGpuAcceleration: 'auto',
    gpuRenderingEnabled: true,
    webglAttachmentDeferred: false,
    webglDisabledAfterContextLoss: false,
    hasComplexScriptOutput: false,
    fitAddon: { fit, proposeDimensions } as never,
    fitResizeObserver: null,
    pendingObservedFitRafId: null,
    searchAddon: {} as never,
    serializeAddon: {} as never,
    unicode11Addon: {} as never,
    webLinksAddon: {} as never,
    webglAddon: null,
    ligaturesAddon: null,
    compositionHandler: null,
    pendingSplitScrollState: null,
    debugLabel: null
  }
}

describe('issue #7118: sidebar toggle should not reset terminal scroll to top', () => {
  it('preserves the scrolled-up viewport across the sidebar-driven refit', () => {
    const pane = createPane()
    const activeBuffer = pane.terminal.buffer.active as { viewportY: number; baseY: number }

    // The user scrolled UP: 100 lines of scrollback, viewport parked at line 42
    // (not at the bottom). This is a pinned viewport, the state that #7118 says
    // gets destroyed by a sidebar toggle.
    activeBuffer.baseY = 100
    activeBuffer.viewportY = 42
    markTerminalPinnedViewport(pane.terminal)

    // Toggling the sidebar reflows the grid; xterm's real fit() resets the
    // native viewport to the top (0). This is the raw event that the user sees
    // as "scroll jumped to top".
    vi.mocked(pane.fitAddon.fit).mockImplementation(() => {
      activeBuffer.viewportY = 0
    })

    // Drive the real product refit path (what the ResizeObserver invokes).
    safeFit(pane)

    // fit did run (the width really changed)...
    expect(pane.fitAddon.fit).toHaveBeenCalledTimes(1)

    // ...but the CURRENT tree captures the pinned scroll before fit and restores
    // it after. The bug from #7118 would leave viewportY at 0 (top) and never
    // call scrollToLine. These assertions encode the FIXED / correct behavior:
    expect(pane.terminal.scrollToLine).toHaveBeenCalledWith(42)
    expect(activeBuffer.viewportY).toBe(42)
    // If #7118 still reproduced, the line below would be the reality instead:
    //   expect(activeBuffer.viewportY).toBe(0) // scrolled to top (BUG)
  })
})

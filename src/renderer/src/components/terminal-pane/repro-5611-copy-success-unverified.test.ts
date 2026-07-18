// @vitest-environment happy-dom
//
// Repro for issue #5611 — "Copying selected Copilot conversation text shows
// success but clipboard is unchanged".
//
// This test drives the REAL terminal keyboard handler
// (`useTerminalKeyboardShortcuts` in ./keyboard-handlers) and dispatches the
// terminal-copy chord (Mod+Shift+C). It pins the buggy behavior described in
// the issue: the copy path fires `window.api.ui.writeClipboardText(selection)`
// but (1) swallows a rejected write with a no-op `.catch`, and (2) never reads
// the clipboard back to confirm the write landed. Because nothing gates on a
// verified write, Orca consumes the keystroke as if the copy succeeded even
// when the clipboard was never updated.
//
// The assertions below marked "BUG" PASS on the current (buggy) tree. Comments
// explain what a correct, verified-copy implementation would do instead.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useTerminalKeyboardShortcuts } from './keyboard-handlers'

type FakeTerminal = { getSelection: () => string; focus: () => void }
type FakePane = { id: number; leafId: string; terminal: FakeTerminal }

function makeManager(pane: FakePane) {
  return {
    getActivePane: () => pane,
    getPanes: () => [pane]
  }
}

function ref<T>(current: T): { current: T } {
  return { current }
}

// The handler reads navigator.userAgent to choose Cmd (mac) vs Ctrl. Mirror
// that here so the dispatched chord matches the resolved default binding
// (terminal.copySelection = Mod+Shift+C) regardless of the test host UA.
const isMac = navigator.userAgent.includes('Mac')

function dispatchCopyChord(): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: 'C',
    code: 'KeyC',
    metaKey: isMac,
    ctrlKey: !isMac,
    shiftKey: true,
    bubbles: true,
    cancelable: true
  })
  window.dispatchEvent(event)
  return event
}

function renderCopyShortcuts(pane: FakePane) {
  return renderHook(() =>
    useTerminalKeyboardShortcuts({
      tabId: 'tab-1',
      worktreeId: 'wt-1',
      isActive: true,
      keyboardScopeRef: ref<HTMLElement | null>(null),
      managerRef: ref(makeManager(pane)),
      paneTransportsRef: ref(new Map()),
      panePtyBindingsRef: ref(new Map()),
      paneCwdRef: ref(new Map()),
      fallbackCwd: '/tmp',
      expandedPaneIdRef: ref<number | null>(null),
      setExpandedPane: vi.fn(),
      restoreExpandedLayout: vi.fn(),
      refreshPaneSizes: vi.fn(),
      persistLayoutSnapshot: vi.fn(),
      toggleExpandPane: vi.fn(),
      setSearchOpen: vi.fn(),
      onSearchSelectedText: vi.fn(),
      onRequestClosePane: vi.fn(),
      onClearPaneScrollback: vi.fn(),
      onSetTitle: vi.fn(),
      onClearPaneTitle: vi.fn(),
      searchOpenRef: ref(false),
      searchStateRef: ref({ query: '', caseSensitive: false, regex: false }),
      macOptionAsAltRef: ref('false')
    } as unknown as Parameters<typeof useTerminalKeyboardShortcuts>[0])
  )
}

describe('issue #5611: terminal copy signals success without a verified clipboard write', () => {
  let writeClipboardText: ReturnType<typeof vi.fn>
  let readClipboardText: ReturnType<typeof vi.fn>
  let unhandledRejections: unknown[]
  const onUnhandledRejection = (event: PromiseRejectionEvent): void => {
    event.preventDefault()
    unhandledRejections.push(event.reason)
  }

  beforeEach(() => {
    writeClipboardText = vi.fn()
    readClipboardText = vi.fn().mockResolvedValue('')
    unhandledRejections = []
    window.addEventListener('unhandledrejection', onUnhandledRejection)
    ;(window as unknown as { api: unknown }).api = {
      ui: { writeClipboardText, readClipboardText }
    }
  })

  afterEach(() => {
    window.removeEventListener('unhandledrejection', onUnhandledRejection)
    delete (window as unknown as { api?: unknown }).api
  })

  const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0))

  it('BUG: consumes the copy chord and swallows a failed clipboard write without any read-back verification', async () => {
    // The OS clipboard write fails (e.g. Windows clipboard busy / access
    // denied — exactly the scenario in the issue where the paste is empty).
    writeClipboardText.mockRejectedValue(new Error('clipboard write failed'))

    const pane: FakePane = {
      id: 1,
      leafId: 'leaf-1',
      terminal: { getSelection: () => 'selected copilot text', focus: vi.fn() }
    }
    const { unmount } = renderCopyShortcuts(pane)

    const event = dispatchCopyChord()
    await flushMicrotasks()

    // The write was attempted with the selected text...
    expect(writeClipboardText).toHaveBeenCalledTimes(1)
    expect(writeClipboardText).toHaveBeenCalledWith('selected copilot text')

    // BUG: Orca consumes the keystroke (preventDefault) as if the copy
    // succeeded, even though the write rejected. A correct implementation would
    // only treat the copy as successful after confirming it.
    expect(event.defaultPrevented).toBe(true)

    // BUG: the rejected write is swallowed by a no-op `.catch`, so nothing —
    // no toast, no thrown error, no unhandled rejection — tells the user the
    // clipboard was never updated.
    expect(unhandledRejections).toHaveLength(0)

    // BUG: the clipboard is never read back to verify the write landed. A
    // verified-copy implementation would call readClipboardText and compare it
    // to the selection before signaling success.
    expect(readClipboardText).not.toHaveBeenCalled()

    unmount()
  })
})

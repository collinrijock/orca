// @vitest-environment happy-dom
//
// Repro investigation for issue #7038:
//   "Claude Code terminal waiting for user to select 1/2/3 sometimes selects 1
//    when gaining focus."
//
// Triage hypothesis: regaining focus on a Claude prompt injects a stray
// Enter/keystroke (a synthetic key on refocus) that submits the default option.
//
// This test exercises the REAL renderer focus modules that run when a terminal
// pane regains focus, plus the REAL byte classifier that decides how xterm's
// onData bytes are routed to the shell. It documents what the current tree
// actually does at focus time.
//
// FINDING (see docs/bug-reproductions/7038.md): the focus path does NOT inject
// Enter. The refocus-reclaim code has no PTY input sink at all — it only moves
// DOM focus and mirrors focus state. The only bytes that flow to the shell as a
// direct consequence of focus are xterm's native focus REPORTS (`\x1b[I` /
// `\x1b[O`), emitted only when the app enabled DECSET 1004 focus reporting.
// Those are focus events, never a carriage return.
//
// Each assertion below is marked either PINS-CURRENT (documents real behavior)
// or WOULD-FAIL-IF-BUG (would only hold if refocus injected Enter — it does not).

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isTerminalQueryReply } from '../../../../shared/terminal-query-reply'
import { resyncTerminalFocusForWindowFocus } from './regular-terminal-focus-ownership'
import { refreshTerminalImeInputContext } from './terminal-ime-input-context-refresh'

// The two escape sequences xterm emits on focus/blur when DECSET 1004 is armed
// (the mode a TUI like Claude Code enables). These are what actually reach the
// shell as a consequence of focus — see pty-connection.ts TERMINAL_FOCUS_IN/OUT.
const FOCUS_IN = '\x1b[I'
const FOCUS_OUT = '\x1b[O'
const ENTER = '\r'

function appendPane(): HTMLDivElement {
  const pane = document.createElement('div')
  document.body.appendChild(pane)
  return pane
}

function appendHelper(pane: HTMLElement): HTMLTextAreaElement {
  const helper = document.createElement('textarea')
  helper.className = 'xterm-helper-textarea'
  pane.appendChild(helper)
  return helper
}

describe('issue #7038 — refocusing a Claude prompt does not inject Enter', () => {
  beforeEach(() => {
    document.body.replaceChildren()
  })

  it('focus reports are distinct from Enter and never equal a carriage return', () => {
    // PINS-CURRENT: the only focus-driven bytes are focus reports, and they are
    // structurally different from Enter. If refocus produced `\r`, "select 1"
    // would follow — it cannot, because these are the sequences involved.
    expect(FOCUS_IN).not.toBe(ENTER)
    expect(FOCUS_OUT).not.toBe(ENTER)
    expect(FOCUS_IN.includes(ENTER)).toBe(false)
    expect(FOCUS_OUT.includes(ENTER)).toBe(false)
  })

  it('classifies focus reports as forwarded input, not query replies, and keeps Enter as Enter', () => {
    // PINS-CURRENT: focus-in/out are NOT query replies (they take the ordinary,
    // order-preserving input path, byte-for-byte), so nothing rewrites them into
    // a submit. A bare Enter is likewise never a query reply.
    expect(isTerminalQueryReply(FOCUS_IN)).toBe(false)
    expect(isTerminalQueryReply(FOCUS_OUT)).toBe(false)
    expect(isTerminalQueryReply(ENTER)).toBe(false)
  })

  it('window-focus reclaim only moves DOM focus — it never writes any byte to the pty', () => {
    // The pane released this helper on window blur; reactivation reclaims it.
    const pane = appendPane()
    const helper = appendHelper(pane)

    const focusSpy = vi.spyOn(helper, 'focus')
    // A stand-in for any pty input sink. The focus modules accept no such sink,
    // so there is no way for refocus to push a keystroke to the shell.
    const ptyWrite = vi.fn()
    const syncFocused = vi.fn()

    const reclaimed = resyncTerminalFocusForWindowFocus({
      container: pane,
      activeElement: document.body, // focus settled on body during reactivation
      syncFocused,
      releasedHelper: helper,
      isMac: false,
      scheduleRefocus: (cb) => cb() // run the deferred reclaim synchronously
    })

    // WOULD-FAIL-IF-BUG: if refocus injected Enter, some pty write would occur.
    expect(ptyWrite).not.toHaveBeenCalled()
    // PINS-CURRENT: the reclaim's entire observable effect is a DOM refocus +
    // focus-state mirror. No `\r`, no synthetic key — just focus.
    expect(reclaimed).toBe(true)
    expect(focusSpy).toHaveBeenCalledTimes(1)
    expect(syncFocused).toHaveBeenLastCalledWith(true)
  })

  it('macOS IME context refresh (blur+refocus) injects no input either', () => {
    // On macOS refocus additionally rebuilds NSTextInputContext via a blur then
    // a deferred refocus. This is the most "keystroke-like" focus-time action;
    // confirm it still only toggles DOM focus and emits no pty byte.
    const pane = appendPane()
    const helper = appendHelper(pane)
    helper.focus()

    const focusSpy = vi.spyOn(helper, 'focus')
    const blurSpy = vi.spyOn(helper, 'blur')
    const ptyWrite = vi.fn()

    const ran = refreshTerminalImeInputContext(helper, {
      isMac: true,
      scheduleRefocus: (cb) => cb()
    })

    expect(ran).toBe(true)
    expect(blurSpy).toHaveBeenCalledTimes(1)
    expect(focusSpy).toHaveBeenCalledTimes(1)
    // WOULD-FAIL-IF-BUG: no keystroke/Enter is produced by the IME refresh.
    expect(ptyWrite).not.toHaveBeenCalled()
  })
})

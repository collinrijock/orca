// @vitest-environment happy-dom
//
// Repro harness for issue #6698: "Vietnamese Telex input in integrated
// terminal loses characters (e.g. 'chính' -> 'ch')".
//
// The issue was filed against v1.4.104. Afterward, PRs #6682 ("Support
// Vietnamese IME and synthetic Unicode in terminal forwarder"), #6699 ("Fix
// macOS IME input mode detection") and #7102 landed. They added a macOS native
// text forwarder that, for a Vietnamese input source, bypasses xterm's kitty
// keyboard encoder on the printable keydown and instead forwards the committed
// glyph straight from the `input` event — the exact mechanism the issue blamed
// ("how Orca/xterm handles IME composition and updates the buffer when the
// composed text is committed").
//
// This test drives the REAL product modules (no reimplementation) with the
// exact word from the issue to demonstrate the CURRENT tree preserves every
// character, i.e. the bug does NOT reproduce here. Assertions marked
// "FIX CHECK" would FAIL if the loss described in #6698 were still present.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installTerminalImeNativeTextForwarder } from './terminal-ime-native-text-forwarder'
import { getMacNativeTextInputSourceFeatures } from './terminal-ime-input-source'
import type { ImeNativeTextKeyEvent } from './terminal-ime-native-text-candidates'

function keyEvent(overrides: Partial<ImeNativeTextKeyEvent>): ImeNativeTextKeyEvent {
  return {
    type: 'keydown',
    key: 'a',
    code: 'KeyA',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    isComposing: false,
    ...overrides
  }
}

function dispatchInsertText(target: HTMLElement, data: string): void {
  target.dispatchEvent(new InputEvent('input', { data, inputType: 'insertText', bubbles: true }))
}

describe('repro #6698 — Vietnamese Telex forwarding in the terminal (current tree)', () => {
  let element: HTMLDivElement
  let textarea: HTMLTextAreaElement

  beforeEach(() => {
    document.body.replaceChildren()
    element = document.createElement('div')
    textarea = document.createElement('textarea')
    textarea.className = 'xterm-helper-textarea'
    element.appendChild(textarea)
    document.body.appendChild(element)
  })

  it('enables short-text replacement forwarding for the macOS built-in Vietnamese Telex source', () => {
    // Real input-source classifier; ids are what the main-process probe returns.
    for (const id of [
      'com.apple.inputmethod.VietnameseIM.VietnameseTelex',
      'com.apple.inputmethod.VietnameseIM.VietnameseSimpleTelex',
      'com.apple.keylayout.Vietnamese'
    ]) {
      const features = getMacNativeTextInputSourceFeatures(id)
      // FIX CHECK: pre-fix, no Vietnamese gate existed, so the forwarder never
      // claimed these keydowns and xterm's kitty encoder truncated the glyph.
      expect(features.forwardShortTextReplacements).toBe(true)
    }
  })

  it('forwards every glyph of "chính" and never truncates to "ch"', () => {
    const features = getMacNativeTextInputSourceFeatures(
      'com.apple.inputmethod.VietnameseIM.VietnameseTelex'
    )
    const sent: string[] = []
    const forwarder = installTerminalImeNativeTextForwarder({
      terminalElement: element,
      isComposing: () => false,
      sendInput: (data) => sent.push(data),
      getInputSourceFeatures: () => features
    })

    // macOS Vietnamese Telex commits the transformed syllable via a native
    // insertText after each printable keydown. Drive the constituent glyphs of
    // the issue word "chính" (c, h, í, n, h) through the real forwarder.
    const glyphs = ['c', 'h', 'í', 'n', 'h']
    for (const glyph of glyphs) {
      // FIX CHECK: the forwarder must CLAIM the keydown (return true) so the
      // caller returns false from attachCustomKeyEventHandler and xterm's kitty
      // encoder cannot swallow/truncate the keystroke — the #6698 root cause.
      expect(forwarder.claimKeyEvent(keyEvent({ key: 'a', code: 'KeyA' }))).toBe(true)
      dispatchInsertText(textarea, glyph)
      expect(forwarder.claimKeyEvent(keyEvent({ type: 'keyup', key: 'a', code: 'KeyA' }))).toBe(true)
    }

    // FIX CHECK: every glyph reaches the PTY. The #6698 symptom was that only
    // "ch" survived and "ính" vanished — that would make this assertion fail.
    expect(sent.join('')).toBe('chính')
  })

  it('forwards a finalized multi-codepoint Vietnamese syllable committed as one insertText', () => {
    const features = getMacNativeTextInputSourceFeatures(
      'com.apple.inputmethod.VietnameseIM.VietnameseTelex'
    )
    const sendInput = vi.fn()
    const forwarder = installTerminalImeNativeTextForwarder({
      terminalElement: element,
      isComposing: () => false,
      sendInput,
      getInputSourceFeatures: () => features
    })

    // Tone key 's' finalizes "chinh" -> "chính"; the toned syllable is committed
    // in a single native insertText carrying the full precomposed word.
    expect(forwarder.claimKeyEvent(keyEvent({ key: 's', code: 'KeyS' }))).toBe(true)
    dispatchInsertText(textarea, 'chính')

    // FIX CHECK: the whole word is forwarded intact, not clipped to "ch".
    expect(sendInput).toHaveBeenCalledExactlyOnceWith('chính')
  })

  it('documents the pre-fix path: a non-Vietnamese source does NOT claim the letter keydown', () => {
    // With no native-text source feature (the v1.4.104 behavior for these keys),
    // the forwarder does not claim printable letter keydowns, so xterm's kitty
    // encoder handled them — the path that produced the #6698 character loss.
    const features = getMacNativeTextInputSourceFeatures('com.apple.keylayout.US')
    const sendInput = vi.fn()
    const forwarder = installTerminalImeNativeTextForwarder({
      terminalElement: element,
      isComposing: () => false,
      sendInput,
      getInputSourceFeatures: () => features
    })

    expect(features.forwardShortTextReplacements).toBe(false)
    expect(forwarder.claimKeyEvent(keyEvent({ key: 'a', code: 'KeyA' }))).toBe(false)
    dispatchInsertText(textarea, 'í')
    expect(sendInput).not.toHaveBeenCalled()
  })
})

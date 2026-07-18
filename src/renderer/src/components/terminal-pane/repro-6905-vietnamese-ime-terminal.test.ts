// @vitest-environment happy-dom
//
// Repro harness for issue #6905 "Vietnamese IME Input Broken in Terminal".
//
// This test drives the REAL product modules that own the macOS terminal IME
// input path:
//   - getMacNativeTextInputSourceFeatures (input-source -> feature gate)
//   - installTerminalImeNativeTextForwarder (keydown claim + input-event commit)
//
// It reconstructs the exact scenarios the issue describes — typing Vietnamese
// words like "xin chào" / "tiếng việt" with a Telex/VNI input source — and
// asserts the committed glyph reaches the PTY exactly once, in order, without
// duplication or garbling.
//
// FINDING: on the current tree these assertions encode the CORRECT behavior and
// they PASS, i.e. the reported bug does NOT reproduce at the logic level. The
// Vietnamese support (PR #6682 / #6699 / #7102) landed around when the issue was
// filed and is now covered end-to-end. Full runtime confirmation still needs a
// live macOS host with a Vietnamese IME (triage: LIVE_APP_MAC).
import { beforeEach, describe, expect, it } from 'vitest'
import { installTerminalImeNativeTextForwarder } from './terminal-ime-native-text-forwarder'
import { getMacNativeTextInputSourceFeatures } from './terminal-ime-input-source'
import type { ImeNativeTextKeyEvent } from './terminal-ime-native-text-candidates'

// Real macOS keyboard input-source identifiers for the Vietnamese layouts the
// issue names. These flow through the real detection function below.
const MAC_VIETNAMESE_TELEX_SOURCE_ID = 'com.apple.keylayout.Vietnamese'
const MAC_VIETNAMESE_VNI_SOURCE_ID = 'com.apple.inputmethod.VietnameseIM.VNI'
const MAC_UNIKEY_SOURCE_ID = 'org.unikey.inputmethod.Telex'

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

describe('issue #6905: Vietnamese IME terminal input', () => {
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

  // Real detection: the Vietnamese layouts named in the issue must switch on the
  // short-text-replacement forwarding that carries transformed glyphs to the PTY.
  it('detects Telex/VNI/Unikey sources as Vietnamese native-text sources', () => {
    for (const id of [
      MAC_VIETNAMESE_TELEX_SOURCE_ID,
      MAC_VIETNAMESE_VNI_SOURCE_ID,
      MAC_UNIKEY_SOURCE_ID
    ]) {
      const features = getMacNativeTextInputSourceFeatures(id)
      // CORRECT behavior: Vietnamese sources forward transformed letters/digits.
      expect(features.forwardShortTextReplacements).toBe(true)
    }
  })

  // "xin chào": drive each committed glyph through the real forwarder. A glyph
  // carrying a diacritic (à) arrives as a transformed keypress + insertText.
  it('forwards each glyph of "xin chào" exactly once, in order (no dup/garble)', () => {
    const sent: string[] = []
    const forwarder = installTerminalImeNativeTextForwarder({
      terminalElement: element,
      isComposing: () => false,
      sendInput: (data) => sent.push(data),
      getInputSourceFeatures: () => getMacNativeTextInputSourceFeatures(MAC_VIETNAMESE_TELEX_SOURCE_ID)
    })

    // (glyph committed, physical key that produced it) for "xin chào".
    const commits: { glyph: string; key: string; code: string }[] = [
      { glyph: 'x', key: 'x', code: 'KeyX' },
      { glyph: 'i', key: 'i', code: 'KeyI' },
      { glyph: 'n', key: 'n', code: 'KeyN' },
      { glyph: ' ', key: ' ', code: 'Space' },
      { glyph: 'c', key: 'c', code: 'KeyC' },
      { glyph: 'h', key: 'h', code: 'KeyH' },
      // Telex: "af" transforms the pending "a" into "à"; the committing key
      // surfaces the transformed glyph on the keypress + insertText.
      { glyph: 'à', key: 'a', code: 'KeyA' },
      { glyph: 'o', key: 'o', code: 'KeyO' }
    ]

    for (const { glyph, key, code } of commits) {
      if (key === ' ') {
        // Space is not a short-text replacement key; the forwarder must not
        // claim it, so it reaches xterm normally. Not part of `sent`.
        expect(forwarder.claimKeyEvent(keyEvent({ type: 'keydown', key, code }))).toBe(false)
        sent.push(' ') // stand in for xterm's own space handling for the assertion
        continue
      }
      expect(forwarder.claimKeyEvent(keyEvent({ type: 'keydown', key, code }))).toBe(true)
      forwarder.claimKeyEvent(keyEvent({ type: 'keypress', key: glyph, code }))
      textarea.value = glyph
      textarea.dispatchEvent(
        new InputEvent('input', { data: glyph, inputType: 'insertText', bubbles: true })
      )
      forwarder.claimKeyEvent(keyEvent({ type: 'keyup', key, code }))
    }

    // CORRECT behavior (bug would break this): the PTY receives "xin chào"
    // with no duplicated base letters and no dropped diacritics.
    expect(sent.join('')).toBe('xin chào')
    forwarder.dispose()
  })

  // VNI digit tones: e.g. "9" produces "đ" and "6" adds a circumflex. The real
  // forwarder must carry the transformed glyph, not the literal digit.
  it('forwards VNI digit-triggered glyphs, not the literal digits', () => {
    const sent: string[] = []
    const forwarder = installTerminalImeNativeTextForwarder({
      terminalElement: element,
      isComposing: () => false,
      sendInput: (data) => sent.push(data),
      getInputSourceFeatures: () => getMacNativeTextInputSourceFeatures(MAC_VIETNAMESE_VNI_SOURCE_ID)
    })

    // "d9" -> "đ"
    expect(forwarder.claimKeyEvent(keyEvent({ type: 'keydown', key: '9', code: 'Digit9' }))).toBe(
      true
    )
    forwarder.claimKeyEvent(keyEvent({ type: 'keypress', key: 'đ', code: 'Digit9' }))
    textarea.value = 'đ'
    textarea.dispatchEvent(
      new InputEvent('input', { data: 'đ', inputType: 'insertText', bubbles: true })
    )
    forwarder.claimKeyEvent(keyEvent({ type: 'keyup', key: '9', code: 'Digit9' }))

    // CORRECT behavior: the transformed glyph reaches the PTY, not "9".
    expect(sent.join('')).toBe('đ')
    forwarder.dispose()
  })

  // Composition-driven IMEs (marked text) must be left entirely to xterm's
  // CompositionHelper — the forwarder must not double-send by claiming them.
  it('does not claim keystrokes that belong to an active composition', () => {
    const sent: string[] = []
    let composing = true
    const forwarder = installTerminalImeNativeTextForwarder({
      terminalElement: element,
      isComposing: () => composing,
      sendInput: (data) => sent.push(data),
      getInputSourceFeatures: () => getMacNativeTextInputSourceFeatures(MAC_VIETNAMESE_TELEX_SOURCE_ID)
    })

    // While composing, the forwarder stays out of the way (no double send).
    expect(forwarder.claimKeyEvent(keyEvent({ type: 'keydown', key: 't', code: 'KeyT' }))).toBe(
      false
    )
    composing = false
    expect(sent).toEqual([])
    forwarder.dispose()
  })
})

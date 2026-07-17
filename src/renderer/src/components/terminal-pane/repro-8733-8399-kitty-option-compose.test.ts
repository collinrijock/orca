/**
 * Issues #8733 + #8399 — Option composition under kitty keyboard protocol.
 *
 * #8733: French-PC, Option as Alt = Off. Shell composes `{` via AltGr; after
 * vim enables kitty protocol, Option chords must stay composed text (not
 * CSI-u Meta). Reload-without-restarting-vim previously appeared to "fix"
 * because SerializeAddon does not persist kitty flags.
 *
 * #8399: German layout Option+L → `@`. Works in bare shell; Pi enables kitty
 * and must still receive `@` rather than physical L as `\x1b[108;3u`.
 *
 * Re-run:
 *   pnpm exec vitest run --config config/vitest.config.ts \
 *     src/renderer/src/components/terminal-pane/repro-8733-8399-kitty-option-compose.test.ts
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveTerminalShortcutAction } from './terminal-shortcut-policy'

function event(partial: {
  key: string
  code?: string
  altKey?: boolean
  shiftKey?: boolean
  metaKey?: boolean
  ctrlKey?: boolean
}): Parameters<typeof resolveTerminalShortcutAction>[0] {
  return {
    key: partial.key,
    code: partial.code,
    altKey: partial.altKey ?? false,
    shiftKey: partial.shiftKey ?? false,
    metaKey: partial.metaKey ?? false,
    ctrlKey: partial.ctrlKey ?? false,
    repeat: false
  }
}

const kittyActive = (): boolean => true
const kittyInactive = (): boolean => false

function resolve(
  input: Parameters<typeof resolveTerminalShortcutAction>[0],
  macOptionAsAlt: 'true' | 'false' | 'left' | 'right' = 'false',
  optionKeyLocation = 0,
  active: () => boolean = kittyActive,
  optionAsAltIsExplicit = false
) {
  return resolveTerminalShortcutAction(
    input,
    true,
    macOptionAsAlt,
    optionKeyLocation,
    false,
    undefined,
    undefined,
    active,
    undefined,
    undefined,
    undefined,
    optionAsAltIsExplicit
  )
}

describe('issue #8733/#8399 kitty Option composition', () => {
  it('sends German Option+L as @ under auto Off + kitty (Pi)', () => {
    expect(resolve(event({ key: '@', code: 'KeyL', altKey: true }))).toEqual({
      type: 'sendInput',
      data: '@'
    })
  })

  it('sends French AltGr-style Option+quote as { under auto Off + kitty (vim)', () => {
    expect(resolve(event({ key: '{', code: 'Quote', altKey: true }), 'false', 2)).toEqual({
      type: 'sendInput',
      data: '{'
    })
  })

  it('sends composed punctuation for explicit Option Off under kitty', () => {
    expect(
      resolve(event({ key: '{', code: 'Quote', altKey: true }), 'false', 0, kittyActive, true)
    ).toEqual({ type: 'sendInput', data: '{' })
    expect(
      resolve(event({ key: '@', code: 'KeyL', altKey: true }), 'false', 0, kittyActive, true)
    ).toEqual({ type: 'sendInput', data: '@' })
  })

  it('with macOptionAsAlt=false + no kitty, Option+L is left for composition', () => {
    expect(
      resolve(event({ key: '@', code: 'KeyL', altKey: true }), 'false', 0, kittyInactive)
    ).toBeNull()
  })

  it('keeps Option+letter CSI-u encoding for TUI hotkeys under auto Off + kitty', () => {
    expect(resolve(event({ key: 'π', code: 'KeyP', altKey: true }))).toEqual({
      type: 'sendInput',
      data: '\x1b[112;3u'
    })
  })

  it('honors explicit left/right Meta vs compose under kitty', () => {
    expect(
      resolve(event({ key: '¬', code: 'KeyL', altKey: true }), 'left', 1, kittyActive, true)
    ).toEqual({ type: 'sendInput', data: '\x1b[108;3u' })
    expect(
      resolve(event({ key: '{', code: 'Quote', altKey: true }), 'left', 2, kittyActive, true)
    ).toEqual({ type: 'sendInput', data: '{' })
    expect(
      resolve(
        event({ key: '∏', code: 'KeyP', altKey: true, shiftKey: true }),
        'right',
        1,
        kittyActive,
        true
      )
    ).toEqual({ type: 'sendInput', data: '∏' })
  })

  it('documents that SerializeAddon path does not serialize kitty flags (reload clears tracker)', () => {
    const tracker = readFileSync(
      join(__dirname, '../../../../shared/terminal-kitty-keyboard-mode-tracker.ts'),
      'utf8'
    )
    // Design comment: xterm SerializeAddon does not serialize kitty flags —
    // reload loses protocol state until the TUI re-pushes (matches #8733).
    expect(tracker).toMatch(/SerializeAddon does not serialize kitty/i)
  })
})

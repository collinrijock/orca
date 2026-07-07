import { describe, expect, it } from 'vitest'
import type { XtermBypassEvent } from './xterm-bypass-policy'
import {
  createTerminalImePendingCandidateKeyRelease,
  isTerminalImeCandidateSelectionKeyEvent,
  shouldApplyTerminalImePendingCandidateKeyRelease,
  shouldClearTerminalImePendingCandidateKeyRelease
} from './terminal-ime-candidate-key-release-guard'
import { TERMINAL_IME_CANDIDATE_GUARD_POST_COMPOSITION_MS } from './terminal-ime-composition-tracker'

function event(overrides: Partial<XtermBypassEvent>): XtermBypassEvent {
  return {
    type: 'keydown',
    key: '',
    code: '',
    defaultPrevented: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides
  }
}

describe('terminal IME candidate key release guard', () => {
  it('recognizes only unmodified Space and digit candidate selectors', () => {
    expect(isTerminalImeCandidateSelectionKeyEvent(event({ key: ' ' }))).toBe(true)
    expect(isTerminalImeCandidateSelectionKeyEvent(event({ key: '2' }))).toBe(true)
    expect(isTerminalImeCandidateSelectionKeyEvent(event({ key: 'a' }))).toBe(false)
    expect(isTerminalImeCandidateSelectionKeyEvent(event({ key: ' ', ctrlKey: true }))).toBe(false)
  })

  it('arms a pending release guard from a suppressed candidate keydown', () => {
    const pending = createTerminalImePendingCandidateKeyRelease(event({ key: '2' }), 10)
    expect(pending).toEqual({
      key: '2',
      expiresAt: 10 + TERMINAL_IME_CANDIDATE_GUARD_POST_COMPOSITION_MS
    })
  })

  it('does not arm from keyup or non-candidate keys', () => {
    expect(
      createTerminalImePendingCandidateKeyRelease(event({ type: 'keyup', key: '2' }), 10)
    ).toBeNull()
    expect(createTerminalImePendingCandidateKeyRelease(event({ key: 'a' }), 10)).toBeNull()
  })

  it('guards the matching keypress and keyup after insertText clears the tracker', () => {
    const pending = createTerminalImePendingCandidateKeyRelease(event({ key: ' ' }), 10)
    expect(
      shouldApplyTerminalImePendingCandidateKeyRelease(
        event({ type: 'keypress', key: ' ' }),
        pending,
        20
      )
    ).toBe(true)
    expect(
      shouldApplyTerminalImePendingCandidateKeyRelease(
        event({ type: 'keyup', key: ' ' }),
        pending,
        20
      )
    ).toBe(true)
  })

  it('does not guard fresh keydowns, other keys, modified keys, or expired releases', () => {
    const pending = createTerminalImePendingCandidateKeyRelease(event({ key: '2' }), 10)
    expect(shouldApplyTerminalImePendingCandidateKeyRelease(event({ key: '2' }), pending, 20)).toBe(
      false
    )
    expect(
      shouldApplyTerminalImePendingCandidateKeyRelease(
        event({ type: 'keyup', key: '3' }),
        pending,
        20
      )
    ).toBe(false)
    expect(
      shouldApplyTerminalImePendingCandidateKeyRelease(
        event({ type: 'keyup', key: '2', ctrlKey: true }),
        pending,
        20
      )
    ).toBe(false)
    expect(
      shouldApplyTerminalImePendingCandidateKeyRelease(
        event({ type: 'keyup', key: '2' }),
        pending,
        10 + TERMINAL_IME_CANDIDATE_GUARD_POST_COMPOSITION_MS + 1
      )
    ).toBe(false)
  })

  it('clears on the matching keyup', () => {
    const pending = createTerminalImePendingCandidateKeyRelease(event({ key: '2' }), 10)
    expect(
      shouldClearTerminalImePendingCandidateKeyRelease(event({ type: 'keypress', key: '2' }), pending)
    ).toBe(false)
    expect(
      shouldClearTerminalImePendingCandidateKeyRelease(event({ type: 'keyup', key: '3' }), pending)
    ).toBe(false)
    expect(
      shouldClearTerminalImePendingCandidateKeyRelease(event({ type: 'keyup', key: '2' }), pending)
    ).toBe(true)
  })
})

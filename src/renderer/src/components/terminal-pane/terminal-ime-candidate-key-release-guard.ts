import type { XtermBypassEvent } from './xterm-bypass-policy'
import { TERMINAL_IME_CANDIDATE_GUARD_POST_COMPOSITION_MS } from './terminal-ime-composition-tracker'

export type TerminalImePendingCandidateKeyRelease = {
  key: string
  expiresAt: number
}

// Why: Sogou/fcitx can deliver candidate-selection keys as plain key events
// (#7543: digit selection inserts only the digit). While the IME owns them,
// they must not reach xterm's encoders or Chromium's default text insertion.
const TERMINAL_IME_CANDIDATE_SELECTION_KEYS = new Set([
  ' ',
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9'
])

export function isTerminalImeCandidateSelectionKeyEvent(event: XtermBypassEvent): boolean {
  // Modified chords (e.g. Ctrl+Space IME toggle) are never candidate selectors.
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return false
  }
  return TERMINAL_IME_CANDIDATE_SELECTION_KEYS.has(event.key)
}

export function createTerminalImePendingCandidateKeyRelease(
  event: XtermBypassEvent,
  now: number
): TerminalImePendingCandidateKeyRelease | null {
  if (event.type !== 'keydown' || !isTerminalImeCandidateSelectionKeyEvent(event)) {
    return null
  }
  return {
    key: event.key,
    expiresAt: now + TERMINAL_IME_CANDIDATE_GUARD_POST_COMPOSITION_MS
  }
}

export function shouldApplyTerminalImePendingCandidateKeyRelease(
  event: XtermBypassEvent,
  pending: TerminalImePendingCandidateKeyRelease | null,
  now: number
): boolean {
  return (
    pending !== null &&
    event.type !== 'keydown' &&
    now <= pending.expiresAt &&
    event.key === pending.key &&
    isTerminalImeCandidateSelectionKeyEvent(event)
  )
}

export function shouldClearTerminalImePendingCandidateKeyRelease(
  event: XtermBypassEvent,
  pending: TerminalImePendingCandidateKeyRelease | null
): boolean {
  return pending !== null && event.type === 'keyup' && event.key === pending.key
}

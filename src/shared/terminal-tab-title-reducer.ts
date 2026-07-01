import type { OscTitleUpdate } from './osc-title-extraction'

export type TerminalTabTitleSource = 'authoritative-tab' | 'legacy-window-fallback'

export type AcceptedTerminalTabTitle = {
  title: string
  source: TerminalTabTitleSource
}

export type TerminalTabTitleReducerState = {
  hasObservedAuthoritativeTabTitle: boolean
}

export function createTerminalTabTitleReducerState(): TerminalTabTitleReducerState {
  return { hasObservedAuthoritativeTabTitle: false }
}

export function acceptTerminalTabTitleUpdate(
  state: TerminalTabTitleReducerState,
  update: OscTitleUpdate
): AcceptedTerminalTabTitle | null {
  if (!update.title.trim()) {
    return null
  }

  if (update.target === 'both' || update.target === 'icon') {
    state.hasObservedAuthoritativeTabTitle = true
    return {
      title: update.title,
      source: 'authoritative-tab'
    }
  }

  if (state.hasObservedAuthoritativeTabTitle) {
    return null
  }

  return {
    title: update.title,
    source: 'legacy-window-fallback'
  }
}

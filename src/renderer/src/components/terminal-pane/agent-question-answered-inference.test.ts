import { describe, expect, it, vi } from 'vitest'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import { createAgentQuestionAnsweredInference } from './agent-question-answered-inference'

const PANE_KEY = 'tab-1:11111111-1111-4111-8111-111111111111'

function makeWaitingQuestionEntry(overrides: Partial<AgentStatusEntry> = {}): AgentStatusEntry {
  return {
    state: 'waiting',
    prompt: 'pick a color',
    updatedAt: 1_000,
    stateStartedAt: 900,
    agentType: 'claude',
    paneKey: PANE_KEY,
    stateHistory: [],
    toolName: 'AskUserQuestion',
    ...overrides
  }
}

function makeInference(entry: AgentStatusEntry | undefined) {
  const inferQuestionAnswered = vi.fn()
  const inference = createAgentQuestionAnsweredInference({
    paneKey: PANE_KEY,
    getStatusEntry: () => entry,
    inferQuestionAnswered,
    now: () => 2_000
  })
  return { inference, inferQuestionAnswered }
}

describe('agent question-answered inference', () => {
  it('reports the baseline when Enter is sent to a waiting question pane', () => {
    const { inference, inferQuestionAnswered } = makeInference(makeWaitingQuestionEntry())

    inference.observeSentTerminalInput('\r')

    expect(inferQuestionAnswered).toHaveBeenCalledExactlyOnceWith({
      paneKey: PANE_KEY,
      baselineUpdatedAt: 1_000,
      baselineStateStartedAt: 900,
      baselinePrompt: 'pick a color',
      baselineAgentType: 'claude'
    })
  })

  it('accepts kitty-keyboard Enter encodings', () => {
    const { inference, inferQuestionAnswered } = makeInference(makeWaitingQuestionEntry())

    inference.observeSentTerminalInput('\x1b[13u')

    expect(inferQuestionAnswered).toHaveBeenCalledOnce()
  })

  it('accepts a bare digit quick-select, which submits without Enter', () => {
    const { inference, inferQuestionAnswered } = makeInference(makeWaitingQuestionEntry())

    inference.observeSentTerminalInput('2')

    expect(inferQuestionAnswered).toHaveBeenCalledOnce()
  })

  it('ignores non-submit input, batched keystrokes, and pastes', () => {
    const { inference, inferQuestionAnswered } = makeInference(makeWaitingQuestionEntry())

    inference.observeSentTerminalInput('\x1b')
    inference.observeSentTerminalInput('a')
    inference.observeSentTerminalInput('0')
    inference.observeSentTerminalInput('12')
    inference.observeSentTerminalInput('yes\r')
    inference.observeSentTerminalInput('\x1b[200~line one\nline two\x1b[201~')

    expect(inferQuestionAnswered).not.toHaveBeenCalled()
  })

  it('ignores panes without a fresh waiting AskUserQuestion status', () => {
    const cases: (AgentStatusEntry | undefined)[] = [
      undefined,
      makeWaitingQuestionEntry({ state: 'working' }),
      makeWaitingQuestionEntry({ toolName: 'Bash' }),
      makeWaitingQuestionEntry({ agentType: 'codex' }),
      // Why: a stale wait past the freshness horizon no longer renders amber,
      // so a keystroke must not synthesize activity for it.
      makeWaitingQuestionEntry({ updatedAt: -100_000_000, stateStartedAt: -100_000_000 })
    ]
    for (const entry of cases) {
      const { inference, inferQuestionAnswered } = makeInference(entry)
      inference.observeSentTerminalInput('\r')
      expect(inferQuestionAnswered).not.toHaveBeenCalled()
    }
  })
})

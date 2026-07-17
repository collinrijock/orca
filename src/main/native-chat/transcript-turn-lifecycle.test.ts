import { describe, expect, it } from 'vitest'
import {
  decodeClaudeTurnLifecycle,
  decodeCodexTurnLifecycle,
  supportsNativeChatTranscriptTurnLifecycle
} from './transcript-turn-lifecycle'

describe('native chat transcript turn lifecycle', () => {
  it('reports which transcript formats have explicit boundaries', () => {
    expect(supportsNativeChatTranscriptTurnLifecycle('claude')).toBe(true)
    expect(supportsNativeChatTranscriptTurnLifecycle('openclaude')).toBe(true)
    expect(supportsNativeChatTranscriptTurnLifecycle('codex')).toBe(true)
    expect(supportsNativeChatTranscriptTurnLifecycle('grok')).toBe(false)
  })

  it('decodes Codex task boundaries with the provider turn id', () => {
    expect(
      decodeCodexTurnLifecycle(
        JSON.stringify({
          timestamp: '2026-07-16T23:40:14.001Z',
          type: 'event_msg',
          payload: { type: 'task_started', turn_id: 'turn-1' }
        }),
        'fallback'
      )
    ).toEqual({
      state: 'working',
      turnId: 'turn-1',
      timestamp: Date.parse('2026-07-16T23:40:14.001Z')
    })

    expect(
      decodeCodexTurnLifecycle(
        JSON.stringify({
          timestamp: '2026-07-16T23:45:37.608Z',
          type: 'event_msg',
          payload: { type: 'task_complete', turn_id: 'turn-1' }
        }),
        'fallback'
      )
    ).toEqual({
      state: 'completed',
      turnId: 'turn-1',
      timestamp: Date.parse('2026-07-16T23:45:37.608Z')
    })

    expect(
      decodeCodexTurnLifecycle(
        JSON.stringify({
          timestamp: '2026-07-16T23:46:01.000Z',
          type: 'event_msg',
          payload: { type: 'turn_aborted', reason: 'interrupted', turn_id: 'turn-2' }
        }),
        'fallback'
      )
    ).toEqual({
      state: 'interrupted',
      turnId: 'turn-2',
      timestamp: Date.parse('2026-07-16T23:46:01.000Z')
    })
  })

  it('does not mistake a Codex assistant message for completion', () => {
    expect(
      decodeCodexTurnLifecycle(
        JSON.stringify({
          timestamp: '2026-07-16T23:45:37.472Z',
          type: 'event_msg',
          payload: { type: 'agent_message', message: 'final-looking prose' }
        }),
        'fallback'
      )
    ).toBeNull()
  })

  it('uses Claude end_turn and excludes tool-result user rows', () => {
    expect(
      decodeClaudeTurnLifecycle(
        JSON.stringify({
          type: 'assistant',
          uuid: 'assistant-1',
          timestamp: '2026-07-16T23:45:37.608Z',
          message: { role: 'assistant', stop_reason: 'end_turn', content: [] }
        }),
        'fallback'
      )
    ).toEqual({
      state: 'completed',
      turnId: 'assistant-1',
      timestamp: Date.parse('2026-07-16T23:45:37.608Z')
    })

    expect(
      decodeClaudeTurnLifecycle(
        JSON.stringify({
          type: 'user',
          uuid: 'tool-result-1',
          timestamp: '2026-07-16T23:45:38.000Z',
          message: {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'ok' }]
          }
        }),
        'fallback'
      )
    ).toBeNull()
  })

  it('excludes Claude tool-result rows that also carry text sidecars', () => {
    expect(
      decodeClaudeTurnLifecycle(
        JSON.stringify({
          type: 'user',
          uuid: 'mixed-tool-result',
          timestamp: '2026-07-16T23:45:38.000Z',
          message: {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: 'tool-1', content: 'ok' },
              { type: 'text', text: '<system-reminder>continue</system-reminder>' }
            ]
          }
        }),
        'fallback'
      )
    ).toBeNull()
  })

  it('treats a real Claude user row as the next working generation', () => {
    expect(
      decodeClaudeTurnLifecycle(
        JSON.stringify({
          type: 'user',
          uuid: 'user-2',
          timestamp: '2026-07-16T23:46:00.000Z',
          message: { role: 'user', content: 'next task' }
        }),
        'fallback'
      )
    ).toEqual({
      state: 'working',
      turnId: 'user-2',
      timestamp: Date.parse('2026-07-16T23:46:00.000Z')
    })
  })

  it('treats Claude interruptedMessageId as terminal instead of a user generation', () => {
    expect(
      decodeClaudeTurnLifecycle(
        JSON.stringify({
          type: 'user',
          uuid: 'interrupt-row',
          interruptedMessageId: 'assistant-request-1',
          timestamp: '2026-07-16T23:46:01.000Z',
          message: {
            role: 'user',
            content: [{ type: 'text', text: '[Request interrupted by user]' }]
          }
        }),
        'fallback'
      )
    ).toEqual({
      state: 'interrupted',
      turnId: 'assistant-request-1',
      timestamp: Date.parse('2026-07-16T23:46:01.000Z')
    })
  })
})

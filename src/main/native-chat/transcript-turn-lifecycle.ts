import type { AgentType, NativeChatTurnLifecycle } from '../../shared/native-chat-types'
import { resolveNativeChatTranscriptAgent } from '../../shared/native-chat-agent-support'
import {
  asRecord,
  extractString,
  parseJsonObject,
  timestampMs
} from '../ai-vault/session-scanner-values'
import { decodeClaudeTranscriptLine } from './transcript-line-decoders-claude'

export type NativeChatTurnLifecycleDecoder = (
  line: string,
  fallbackId: string
) => NativeChatTurnLifecycle | null

export function nativeChatTurnLifecycleDecoderForAgent(
  agent: AgentType
): NativeChatTurnLifecycleDecoder | null {
  const transcriptAgent = resolveNativeChatTranscriptAgent(agent)
  if (transcriptAgent === 'codex') {
    return decodeCodexTurnLifecycle
  }
  if (transcriptAgent === 'claude') {
    return decodeClaudeTurnLifecycle
  }
  return null
}

export function supportsNativeChatTranscriptTurnLifecycle(agent: AgentType): boolean {
  return nativeChatTurnLifecycleDecoderForAgent(agent) !== null
}

export function decodeCodexTurnLifecycle(
  line: string,
  fallbackId: string
): NativeChatTurnLifecycle | null {
  const record = parseJsonObject(line)
  const payload = asRecord(record?.payload)
  if (record?.type !== 'event_msg' || !payload) {
    return null
  }
  if (
    payload.type !== 'task_started' &&
    payload.type !== 'task_complete' &&
    payload.type !== 'turn_aborted'
  ) {
    return null
  }
  const state =
    payload.type === 'task_started'
      ? 'working'
      : payload.type === 'turn_aborted'
        ? 'interrupted'
        : 'completed'
  return {
    state,
    turnId: extractString(payload.turn_id) ?? fallbackId,
    timestamp: lifecycleTimestamp(record.timestamp)
  }
}

/** Claude stop reasons that end the lead generation (not mid-turn tool_use). */
const CLAUDE_TERMINAL_STOP_REASONS = new Set(['end_turn', 'max_tokens', 'stop_sequence', 'refusal'])

function isClaudeTerminalStopReason(value: unknown): boolean {
  return typeof value === 'string' && CLAUDE_TERMINAL_STOP_REASONS.has(value)
}

export function decodeClaudeTurnLifecycle(
  line: string,
  fallbackId: string
): NativeChatTurnLifecycle | null {
  const record = parseJsonObject(line)
  if (!record) {
    return null
  }
  const message = asRecord(record.message)
  const timestamp = lifecycleTimestamp(record.timestamp)
  const interruptedMessageId = extractString(record.interruptedMessageId)
  if (record.type === 'user' && interruptedMessageId) {
    // Why: Claude stores its interrupt notice as an injected user row; it ends
    // the active generation and must not be mistaken for the next user prompt.
    return { state: 'interrupted', turnId: interruptedMessageId, timestamp }
  }
  // Why: capable hosts disable the prose-fallback settlement path, so every
  // real terminal stop_reason must emit completed — not only end_turn.
  if (record.type === 'assistant' && isClaudeTerminalStopReason(message?.stop_reason)) {
    return {
      state: 'completed',
      turnId: extractString(record.uuid) ?? extractString(message?.id) ?? fallbackId,
      timestamp
    }
  }
  if (record.type !== 'user') {
    return null
  }
  const decoded = decodeClaudeTranscriptLine(line, fallbackId)
  if (decoded?.role !== 'user' || decoded.blocks.some((block) => block.type === 'tool-result')) {
    // Why: Claude can attach text sidecars to tool-result user rows; those are
    // continuations of the active turn, not a new user-authored generation.
    return null
  }
  return { state: 'working', turnId: decoded.id, timestamp }
}

function lifecycleTimestamp(value: unknown): number | null {
  const parsed = timestampMs(value)
  return Number.isFinite(parsed) ? parsed : null
}

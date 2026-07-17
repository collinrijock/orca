// Pure merge of live hook turn-state into a NativeChatSession status override.
// Kept separate from the React hook so the precedence rule (live 'working'
// surfaces before the transcript flushes its explicit terminal record, then is
// reconciled once that boundary lands) is unit-testable without IPC.

import type { AgentStatusState } from '../../../../shared/agent-status-types'
import { assembleNativeChatSession, type NativeChatSources } from './native-chat-session-assembler'
import type {
  AgentType,
  NativeChatSession,
  NativeChatSessionStatus,
  NativeChatTurnLifecycle
} from '../../../../shared/native-chat-types'

export type NativeChatLiveMergeInput = {
  sources: NativeChatSources
  sessionId: string | null
  agent: AgentType
  /** Live hook state for the pane, or null when no hook entry exists. */
  hookState: AgentStatusState | null
  /** Epoch ms when the current hook state began, or null when unknown. */
  stateStartedAt?: number | null
  /** Latest provider-authored turn boundary recovered from the transcript. */
  transcriptLifecycle?: NativeChatTurnLifecycle
  /** Whether the serving host can decode explicit transcript turn boundaries. */
  turnLifecycleCapable?: boolean
  /** Claude can finish its lead turn while background children remain active. */
  hookHasWorkingSubagents?: boolean
  /** True before the initial snapshot resolves; forces 'loading'. */
  loading?: boolean
  /** Set when the initial snapshot failed; forces 'error'. */
  error?: string
}

/**
 * Decide the session status given the merged transcript/append messages and the
 * live hook state. The transcript is the source of truth for content; explicit
 * provider lifecycle records reconcile a dropped final hook.
 *
 * Precedence:
 *   - errors win outright; live work wins over transcript loading.
 *   - hook 'working' stays authoritative until the hook exits that state OR an
 *     explicit terminal marker for this turn lands.
 */
export function mergeNativeChatLiveSession(input: NativeChatLiveMergeInput): NativeChatSession {
  const {
    sources,
    sessionId,
    agent,
    hookState,
    stateStartedAt,
    transcriptLifecycle,
    turnLifecycleCapable,
    hookHasWorkingSubagents,
    loading,
    error
  } = input
  if (error) {
    return assembleNativeChatSession({ sources, sessionId, agent, status: 'error', error })
  }

  const status = liveStatusOverride(
    hookState,
    sources,
    stateStartedAt,
    transcriptLifecycle,
    turnLifecycleCapable ?? false,
    hookHasWorkingSubagents ?? false
  )
  if (loading && status !== 'working') {
    return assembleNativeChatSession({ sources, sessionId, agent, status: 'loading' })
  }
  return assembleNativeChatSession({
    sources,
    sessionId,
    agent,
    ...(status ? { status } : {})
  })
}

function liveStatusOverride(
  hookState: AgentStatusState | null,
  sources: NativeChatSources,
  stateStartedAt: number | null | undefined,
  transcriptLifecycle: NativeChatTurnLifecycle | undefined,
  turnLifecycleCapable: boolean,
  hookHasWorkingSubagents: boolean
): NativeChatSessionStatus | undefined {
  // Only 'working' drives a live override; blocked/waiting/done leave the
  // derived (ready/empty) status alone so completed turns render normally.
  if (hookState !== 'working') {
    return undefined
  }
  const terminatesCurrentTurn = lifecycleTerminatesCurrentTurn(transcriptLifecycle, stateStartedAt)
  // Why: an explicit interruption ends the whole turn, children included, so it
  // settles the session even while a stale child status still reads working.
  if (terminatesCurrentTurn && transcriptLifecycle?.state === 'interrupted') {
    return undefined
  }
  // Why: a lead completion does not end Claude's aggregate turn while a
  // background child still runs; the hook roster owns that extra lifetime.
  if (hookHasWorkingSubagents) {
    return 'working'
  }
  if (terminatesCurrentTurn) {
    return undefined
  }
  // Why: Grok and older remote hosts have no explicit boundary decoder. Keep
  // their degraded recovery without letting prose override capable providers.
  if (
    !turnLifecycleCapable &&
    transcriptLifecycle === undefined &&
    trailingAssistantPostDates(sources, stateStartedAt)
  ) {
    return undefined
  }
  return 'working'
}

function lifecycleTerminatesCurrentTurn(
  lifecycle: NativeChatTurnLifecycle | undefined,
  stateStartedAt: number | null | undefined
): boolean {
  if (lifecycle?.state !== 'completed' && lifecycle?.state !== 'interrupted') {
    return false
  }
  if (stateStartedAt == null || lifecycle.timestamp == null) {
    // Why: without comparable timing, a replayed terminal marker could belong to
    // the prior turn and must not hide a newer live working signal.
    return false
  }
  return lifecycle.timestamp >= stateStartedAt
}

function trailingAssistantPostDates(
  sources: NativeChatSources,
  stateStartedAt: number | null | undefined
): boolean {
  if (stateStartedAt == null) {
    return false
  }
  const last = (sources.transcript ?? []).at(-1)
  return last?.role === 'assistant' && last.timestamp != null && last.timestamp >= stateStartedAt
}

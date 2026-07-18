import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createAgentCompletionCoordinator,
  resetAgentCompletionCoordinatorIdentitiesForTest
} from './agent-completion-coordinator'
import { resetAgentProcessInspectionQueueForTests } from './agent-process-inspection-queue'

// Repro for issue #4630: "Claude-Mem Causes Spam of Notifications even if 'Main'
// Agent is Done".
//
// Claude-Mem is a background plugin that, after the user's turn has already
// finished, runs its own work through Claude's hook stream: a `PostToolUse`
// event (which normalizeClaudeEvent maps to state 'working' — see
// src/shared/agent-hook-listener.ts:2601-2611) followed by a `Stop` event
// (state 'done'). It carries no user prompt.
//
// The completion coordinator's `observeHookStatus` 'working' branch
// (agent-completion-coordinator.ts:846-859) treats ANY 'working' hook as a new
// turn boundary: it flips `workingStatusObserved` back on and bumps
// `currentTurn`. That re-arm makes the subsequent background 'done' look like a
// brand-new completed turn, so a SECOND agent-task-complete notification is
// dispatched even though the user's turn ended 8 seconds earlier and nothing
// they asked for is happening.
//
// This test drives the REAL coordinator with a Claude-shaped user turn, then the
// Claude-Mem-shaped background cycle, and pins the buggy double-dispatch.

const HOOK_DONE_QUIET_MS = 1_500

describe('repro #4630: Claude-Mem background cycle re-notifies after the user turn is done', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Pin poll jitter so nothing else in the coordinator is timing-sensitive.
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
  })

  afterEach(() => {
    resetAgentProcessInspectionQueueForTests()
    resetAgentCompletionCoordinatorIdentitiesForTest()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('dispatches a SECOND completion for the Claude-Mem PostToolUse/Stop cycle (bug)', () => {
    const dispatchCompletion = vi.fn()
    const coordinator = createAgentCompletionCoordinator({
      paneKey: 'tab-1:leaf-1',
      getPtyId: () => 'pty-1',
      getSettings: () => null,
      // Process inspection is never started (startProcessTracking is not called),
      // so the ONLY completion source here is the hook stream — isolating the
      // working/done re-arm as the cause.
      inspectProcess: vi.fn(),
      dispatchCompletion,
      isLive: () => true
    })

    // --- Main user turn: UserPromptSubmit (working, with a real prompt) -> Stop.
    coordinator.observeHookStatus({
      state: 'working',
      prompt: 'add a unit test for the parser',
      agentType: 'claude',
      stateStartedAt: 1_700_000_000_000
    })
    coordinator.observeHookStatus({
      state: 'done',
      prompt: 'add a unit test for the parser',
      agentType: 'claude',
      stateStartedAt: 1_700_000_001_000
    })
    // Quiet window elapses -> the one expected task-complete notification fires.
    vi.advanceTimersByTime(HOOK_DONE_QUIET_MS)

    expect(dispatchCompletion).toHaveBeenCalledTimes(1)

    // --- 8 seconds later, the user is idle and the turn is over. Claude-Mem runs
    // its background bookkeeping: a PostToolUse (state 'working', NO prompt) then
    // a Stop (state 'done'). No user prompt was ever submitted.
    vi.advanceTimersByTime(8_000)
    coordinator.observeHookStatus({
      state: 'working',
      prompt: '',
      agentType: 'claude',
      stateStartedAt: 1_700_000_009_000
    })
    coordinator.observeHookStatus({
      state: 'done',
      prompt: '',
      agentType: 'claude',
      stateStartedAt: 1_700_000_010_000
    })
    vi.advanceTimersByTime(HOOK_DONE_QUIET_MS)

    // BUG (issue #4630): the background memory/plugin cycle re-armed the turn and
    // dispatched a SECOND completion notification. This assertion encodes the
    // WRONG behavior and PASSES on the current tree.
    //
    // CORRECT behavior would be `toHaveBeenCalledTimes(1)` — a background hook
    // cycle with no user prompt, after the user's turn already completed, should
    // not raise another "agent task complete" notification.
    expect(dispatchCompletion).toHaveBeenCalledTimes(2)
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  normalizeAgentStatusPayload,
  type AgentStatusEntry
} from '../../../../shared/agent-status-types'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import type { TerminalTab } from '../../../../shared/types'
import { resolveWorktreeStatus } from '@/lib/worktree-status'
import {
  selectWorktreeAgentActivitySummary,
  type AgentActivityInput
} from './worktree-agent-activity-summary'

/**
 * Repro for issue #9040 — "No processing/thinking indicators in left nav".
 *
 * Symptom (v1.4.141+): while an agent is still working the sidebar shows no
 * thinking spinner, yet the "done" bell still appears once it finishes.
 *
 * Root cause exercised here: the shared agent-status normalizer
 * (`normalizeAgentStatusPayload`) does NOT gate a `done` lead payload that
 * still carries a live *working* subagent up to `working`. Any Orca-compatible
 * status producer (OpenCode / MiMo / Copilot / custom relay) that publishes
 * lead completion while a child is still running therefore lands in the store
 * as `state: 'done'`. The renderer's working-status derivation only reads
 * `entry.state`, so the worktree dot resolves to `done` (green/bell) instead of
 * `working` (spinner) — exactly the reported "no thinking indicator" symptom.
 *
 * The open fix PR #9048 adds the generic gate:
 *   const state = rawState === 'done' && hasWorkingSubagent ? 'working' : rawState
 *
 * The assertions below PIN the current (buggy) behavior: they PASS today while
 * asserting the WRONG result. Lines marked `BUG:` are what a fix must flip.
 */
const LEAF_ID = '11111111-1111-4111-8111-111111111111'
const WORKTREE_ID = 'repo::/wt-1'

function makeTab(id: string, worktreeId: string): TerminalTab {
  return {
    id,
    ptyId: null,
    worktreeId,
    title: id,
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 0
  }
}

function buildActivityInput(state: AgentStatusEntry['state']): AgentActivityInput {
  const paneKey = makePaneKey('tab-1', LEAF_ID)
  const entry: AgentStatusEntry = {
    paneKey,
    state,
    prompt: '',
    updatedAt: 1_000,
    stateStartedAt: 1_000,
    stateHistory: [],
    worktreeId: WORKTREE_ID,
    orchestration: undefined
  }
  return {
    tabsByWorktree: { [WORKTREE_ID]: [makeTab('tab-1', WORKTREE_ID)] },
    agentStatusEpoch: 0,
    agentStatusByPaneKey: { [paneKey]: entry },
    migrationUnsupportedByPtyId: {},
    runtimeAgentOrchestrationByPaneKey: {},
    retainedAgentsByPaneKey: {}
  }
}

describe('repro #9040: working subagent under a done lead loses the thinking indicator', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('normalizer keeps state=done even though a live working child means the pane is still working', () => {
    const normalized = normalizeAgentStatusPayload({
      state: 'done',
      agentType: 'opencode',
      subagents: [{ id: 'reviewer-1', state: 'working', startedAt: 900 }]
    })

    expect(normalized).not.toBeNull()
    // The child IS parsed and IS working...
    expect(normalized?.subagents).toEqual([
      { id: 'reviewer-1', state: 'working', startedAt: 900, agentType: undefined, description: undefined }
    ])
    // ...but the pane state is left at 'done'.
    // BUG: current tree returns 'done'. Correct behavior (PR #9048): 'working'.
    expect(normalized?.state).toBe('done')
  })

  it('sidebar working-status derivation resolves the worktree dot to done (bell) instead of working (spinner)', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)

    // Feed the store the state the normalizer produces for a done-with-working-child payload.
    const doneState = normalizeAgentStatusPayload({
      state: 'done',
      agentType: 'opencode',
      subagents: [{ id: 'reviewer-1', state: 'working', startedAt: 900 }]
    })?.state
    expect(doneState).toBe('done')

    const input = buildActivityInput(doneState as AgentStatusEntry['state'])
    const summary = selectWorktreeAgentActivitySummary(input, WORKTREE_ID)

    // The child's live work never becomes a live-working signal for the worktree.
    // BUG: hasLiveWorking should be true (an agent is still thinking).
    expect(summary.hasLiveWorking).toBe(false)
    expect(summary.hasLiveDone).toBe(true)

    const status = resolveWorktreeStatus({
      tabs: input.tabsByWorktree[WORKTREE_ID],
      browserTabs: [],
      ptyIdsByTabId: { 'tab-1': ['pty-1'] },
      runtimePaneTitlesByTabId: {},
      agentStatusPaneIdsByTabId: summary.agentStatusPaneIdsByTabId,
      hasPermission: summary.hasPermission,
      hasLiveWorking: summary.hasLiveWorking,
      hasLiveDone: summary.hasLiveDone,
      hasRetainedDone: summary.hasRetainedDone
    })

    // BUG: the sidebar dot is 'done' while the agent is still working.
    // Correct behavior would be 'working' so the nav shows the thinking spinner.
    expect(status).toBe('done')
  })

  it('control: a correctly gated working payload DOES light the spinner (what the fix should produce)', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)

    // Simulate the post-#9048 normalized state ('working') to show the derivation
    // itself is fine — the loss happens upstream at normalization.
    const input = buildActivityInput('working')
    const summary = selectWorktreeAgentActivitySummary(input, WORKTREE_ID)
    const status = resolveWorktreeStatus({
      tabs: input.tabsByWorktree[WORKTREE_ID],
      browserTabs: [],
      ptyIdsByTabId: { 'tab-1': ['pty-1'] },
      runtimePaneTitlesByTabId: {},
      agentStatusPaneIdsByTabId: summary.agentStatusPaneIdsByTabId,
      hasPermission: summary.hasPermission,
      hasLiveWorking: summary.hasLiveWorking,
      hasLiveDone: summary.hasLiveDone,
      hasRetainedDone: summary.hasRetainedDone
    })

    expect(summary.hasLiveWorking).toBe(true)
    expect(status).toBe('working')
  })
})

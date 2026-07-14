import { describe, expect, it } from 'vitest'
import type { SleepingAgentSessionRecord } from '../../../../shared/agent-session-resume'
import type { TerminalTab } from '../../../../shared/types'
import {
  buildTerminalTabRetirementPlan,
  isTerminalTabPresent,
  removeSleepingAgentSessionsForTab
} from './terminal-tab-retirement'

type RetirementState = Parameters<typeof buildTerminalTabRetirementPlan>[0]

function makeTab(id: string, worktreeId: string, ptyId: string | null): TerminalTab {
  return {
    id,
    worktreeId,
    ptyId,
    title: id,
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 0
  }
}

function makeState(overrides: Partial<RetirementState> = {}): RetirementState {
  return {
    tabsByWorktree: {},
    unifiedTabsByWorktree: {},
    ptyIdsByTabId: {},
    terminalLayoutsByTabId: {},
    lastKnownRelayPtyIdByTabId: {},
    deferredSshSessionIdsByTabId: {},
    pendingReconnectPtyIdByTabId: {},
    ...overrides
  }
}

function makeSleepingRecord(paneKey: string, tabId?: string): SleepingAgentSessionRecord {
  return {
    paneKey,
    tabId,
    worktreeId: 'wt-1',
    agent: 'codex',
    providerSession: { key: 'session_id', id: paneKey },
    prompt: 'continue',
    state: 'working',
    capturedAt: 1,
    updatedAt: 1
  }
}

describe('terminal tab retirement planning', () => {
  it('collects and deduplicates every ownership source before routing providers', () => {
    const state = makeState({
      tabsByWorktree: {
        'wt-1': [makeTab('tab-1', 'wt-1', 'pty-row')]
      },
      ptyIdsByTabId: { 'tab-1': ['pty-index', 'pty-row'] },
      terminalLayoutsByTabId: {
        'tab-1': {
          root: null,
          activeLeafId: null,
          expandedLeafId: null,
          ptyIdsByLeafId: {
            leaf1: 'pty-layout',
            leaf2: 'remote:env-1@@terminal-1'
          }
        }
      },
      lastKnownRelayPtyIdByTabId: { 'tab-1': 'ssh:ssh-1@@relay-pty' },
      deferredSshSessionIdsByTabId: { 'tab-1': 'pty-deferred' },
      pendingReconnectPtyIdByTabId: { 'tab-1': 'pty-pending' }
    })

    expect(buildTerminalTabRetirementPlan(state, 'tab-1')).toEqual({
      tabId: 'tab-1',
      worktreeId: 'wt-1',
      ptyIds: [
        'pty-index',
        'pty-row',
        'pty-layout',
        'remote:env-1@@terminal-1',
        'ssh:ssh-1@@relay-pty',
        'pty-deferred',
        'pty-pending'
      ],
      localOrSshPtyIds: [
        'pty-index',
        'pty-row',
        'pty-layout',
        'ssh:ssh-1@@relay-pty',
        'pty-deferred',
        'pty-pending'
      ],
      runtimeTerminals: [
        {
          ptyId: 'remote:env-1@@terminal-1',
          environmentId: 'env-1',
          handle: 'terminal-1'
        }
      ],
      sharedPtyIds: [],
      unroutablePtyIds: []
    })
    expect(isTerminalTabPresent(state, 'tab-1')).toBe(true)
  })

  it('does not retire a PTY still referenced by another live surface', () => {
    const shared = 'pty-in-transfer'
    const state = makeState({
      tabsByWorktree: {
        'wt-1': [makeTab('tab-1', 'wt-1', shared), makeTab('tab-2', 'wt-1', null)]
      },
      ptyIdsByTabId: { 'tab-1': [shared], 'tab-2': [shared] },
      terminalLayoutsByTabId: {
        'tab-2': {
          root: null,
          activeLeafId: null,
          expandedLeafId: null,
          ptyIdsByLeafId: { leaf2: shared }
        }
      }
    })

    const plan = buildTerminalTabRetirementPlan(state, 'tab-1')
    expect(plan.sharedPtyIds).toEqual([shared])
    expect(plan.localOrSshPtyIds).toEqual([])
    expect(plan.runtimeTerminals).toEqual([])
  })

  it('ignores stale ownership maps and never routes malformed remote ids locally', () => {
    const malformedRemote = 'remote:'
    const state = makeState({
      tabsByWorktree: {
        'wt-1': [makeTab('tab-1', 'wt-1', malformedRemote)]
      },
      ptyIdsByTabId: {
        'tab-1': [malformedRemote, 'pty-live'],
        'stale-tab': ['pty-live']
      }
    })

    const plan = buildTerminalTabRetirementPlan(state, 'tab-1')
    expect(plan.unroutablePtyIds).toEqual([malformedRemote])
    expect(plan.localOrSshPtyIds).toEqual(['pty-live'])
    expect(plan.sharedPtyIds).toEqual([])
  })
})

describe('sleeping agent retirement', () => {
  it('removes key- and metadata-owned records while preserving siblings by reference', () => {
    const sibling = makeSleepingRecord('tab-2:leaf-2', 'tab-2')
    const records = {
      'tab-1:leaf-1': makeSleepingRecord('tab-1:leaf-1'),
      'legacy-pane-key': makeSleepingRecord('legacy-pane-key', 'tab-1'),
      'tab-2:leaf-2': sibling
    }

    const next = removeSleepingAgentSessionsForTab(records, 'tab-1')
    expect(next).toEqual({ 'tab-2:leaf-2': sibling })
    expect(next['tab-2:leaf-2']).toBe(sibling)
    expect(removeSleepingAgentSessionsForTab(next, 'missing-tab')).toBe(next)
  })
})

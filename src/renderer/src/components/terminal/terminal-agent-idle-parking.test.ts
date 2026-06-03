import { describe, expect, it } from 'vitest'
import {
  summarizeTerminalAgentIdleParking,
  terminalAgentIdleParkingSummariesEqual
} from './terminal-agent-idle-parking'

function emptyState() {
  return {
    tabsByWorktree: {},
    agentStatusByPaneKey: {},
    migrationUnsupportedByPtyId: {},
    retainedAgentsByPaneKey: {}
  }
}

describe('summarizeTerminalAgentIdleParking', () => {
  it('marks completed agents by live pane status and retained rows', () => {
    const summaries = summarizeTerminalAgentIdleParking({
      ...emptyState(),
      tabsByWorktree: {
        'wt-live': [{ id: 'tab-live' }],
        'wt-retained': [{ id: 'tab-retained' }]
      },
      agentStatusByPaneKey: {
        'tab-live:1': { state: 'done' }
      },
      retainedAgentsByPaneKey: {
        'tab-retained:1': { worktreeId: 'wt-retained' }
      }
    })

    expect(summaries.get('wt-live')).toEqual({
      hasCompletedAgent: true,
      hasActiveAgent: false
    })
    expect(summaries.get('wt-retained')).toEqual({
      hasCompletedAgent: true,
      hasActiveAgent: false
    })
  })

  it('uses hook worktree attribution when the pane tab is not mounted', () => {
    const summaries = summarizeTerminalAgentIdleParking({
      ...emptyState(),
      agentStatusByPaneKey: {
        'missing-tab:1': { state: 'done', worktreeId: 'wt-attributed' }
      }
    })

    expect(summaries.get('wt-attributed')).toEqual({
      hasCompletedAgent: true,
      hasActiveAgent: false
    })
  })

  it('treats working, blocked, waiting, and migration-unsupported rows as active', () => {
    const summaries = summarizeTerminalAgentIdleParking({
      ...emptyState(),
      tabsByWorktree: {
        'wt-active': [{ id: 'tab-working' }, { id: 'tab-blocked' }, { id: 'tab-waiting' }],
        'wt-migration': [{ id: 'tab-migration' }]
      },
      agentStatusByPaneKey: {
        'tab-working:1': { state: 'working' },
        'tab-blocked:1': { state: 'blocked' },
        'tab-waiting:1': { state: 'waiting' }
      },
      migrationUnsupportedByPtyId: {
        'pty-1': { paneKey: 'tab-migration:1' }
      },
      retainedAgentsByPaneKey: {
        'tab-working:done': { worktreeId: 'wt-active' }
      }
    })

    expect(summaries.get('wt-active')).toEqual({
      hasCompletedAgent: true,
      hasActiveAgent: true
    })
    expect(summaries.get('wt-migration')).toEqual({
      hasCompletedAgent: false,
      hasActiveAgent: true
    })
  })
})

describe('terminalAgentIdleParkingSummariesEqual', () => {
  it('compares only worktree summary fields', () => {
    expect(
      terminalAgentIdleParkingSummariesEqual(
        new Map([['wt-1', { hasCompletedAgent: true, hasActiveAgent: false }]]),
        new Map([['wt-1', { hasCompletedAgent: true, hasActiveAgent: false }]])
      )
    ).toBe(true)
    expect(
      terminalAgentIdleParkingSummariesEqual(
        new Map([['wt-1', { hasCompletedAgent: true, hasActiveAgent: false }]]),
        new Map([['wt-1', { hasCompletedAgent: true, hasActiveAgent: true }]])
      )
    ).toBe(false)
  })
})

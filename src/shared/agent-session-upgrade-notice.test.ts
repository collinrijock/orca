import { describe, it, expect } from 'vitest'
import type { SleepingAgentSessionRecord } from './agent-session-resume'
import type { TerminalTab, WorkspaceSessionState } from './types'
import {
  AGENT_SESSION_CAPTURE_VERSION,
  shouldNotifyPreUpgradeAgentSessionLoss
} from './agent-session-upgrade-notice'

function agentTab(launchAgent: string | undefined): TerminalTab {
  return { launchAgent } as unknown as TerminalTab
}

function record(origin: SleepingAgentSessionRecord['origin']): SleepingAgentSessionRecord {
  return { origin } as unknown as SleepingAgentSessionRecord
}

function session(
  overrides: Partial<
    Pick<
      WorkspaceSessionState,
      'agentSessionCaptureVersion' | 'tabsByWorktree' | 'sleepingAgentSessionsByPaneKey'
    >
  >
): Pick<
  WorkspaceSessionState,
  'agentSessionCaptureVersion' | 'tabsByWorktree' | 'sleepingAgentSessionsByPaneKey'
> {
  return { tabsByWorktree: {}, ...overrides }
}

describe('shouldNotifyPreUpgradeAgentSessionLoss', () => {
  it('warns for a pre-fix session: agent tab, no records, no stamp (#5356)', () => {
    expect(
      shouldNotifyPreUpgradeAgentSessionLoss(
        session({ tabsByWorktree: { wt: [agentTab('codex')] } })
      )
    ).toBe(true)
  })

  it('does not warn once the capture stamp is present', () => {
    expect(
      shouldNotifyPreUpgradeAgentSessionLoss(
        session({
          agentSessionCaptureVersion: AGENT_SESSION_CAPTURE_VERSION,
          tabsByWorktree: { wt: [agentTab('codex')] }
        })
      )
    ).toBe(false)
  })

  it('does not warn when a quit/live capture record exists (working post-#5232 upgrade)', () => {
    // The critical false-positive guard: on the first launch of the fixed build
    // NO session has the brand-new stamp yet, so a working post-#5232 build must
    // be distinguished by its resume records — those sessions ARE being restored.
    expect(
      shouldNotifyPreUpgradeAgentSessionLoss(
        session({
          tabsByWorktree: { wt: [agentTab('codex')] },
          sleepingAgentSessionsByPaneKey: { 'tab:0': record('quit') }
        })
      )
    ).toBe(false)
    expect(
      shouldNotifyPreUpgradeAgentSessionLoss(
        session({
          tabsByWorktree: { wt: [agentTab('codex')] },
          sleepingAgentSessionsByPaneKey: { 'tab:0': record('live') }
        })
      )
    ).toBe(false)
  })

  it('still warns when only a worktree-sleep record exists (does not resume cold-restored panes)', () => {
    expect(
      shouldNotifyPreUpgradeAgentSessionLoss(
        session({
          tabsByWorktree: { wt: [agentTab('codex')] },
          sleepingAgentSessionsByPaneKey: { 'tab:0': record('worktree-sleep') }
        })
      )
    ).toBe(true)
  })

  it('does not warn for plain terminals with no agent tab', () => {
    expect(
      shouldNotifyPreUpgradeAgentSessionLoss(
        session({ tabsByWorktree: { wt: [agentTab(undefined)] } })
      )
    ).toBe(false)
  })

  it('does not warn for an unknown/non-resumable launchAgent', () => {
    expect(
      shouldNotifyPreUpgradeAgentSessionLoss(session({ tabsByWorktree: { wt: [agentTab('pi')] } }))
    ).toBe(false)
  })

  it('does not warn for a fresh session with no tabs', () => {
    expect(shouldNotifyPreUpgradeAgentSessionLoss(session({ tabsByWorktree: {} }))).toBe(false)
    expect(shouldNotifyPreUpgradeAgentSessionLoss(session({ tabsByWorktree: undefined }))).toBe(
      false
    )
  })
})

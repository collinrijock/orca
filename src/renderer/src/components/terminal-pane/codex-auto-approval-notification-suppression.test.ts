import { beforeEach, describe, expect, it, vi } from 'vitest'
import { YOLO_TUI_AGENT_ARGS } from '../../../../shared/tui-agent-permissions'
import { createTestStore, makeTab } from '../../store/slices/store-test-helpers'
import type { AppState } from '../../store/types'

let testStore: ReturnType<typeof createTestStore>

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => testStore.getState()
  }
}))

import { isAutoApprovedCodexPermissionStatus } from './codex-auto-approval-notification-suppression'

describe('Codex auto-approval notification suppression', () => {
  beforeEach(() => {
    testStore = createTestStore()
  })

  it('uses the production launch-config resolver for launch-token registered Codex panes', () => {
    const paneKey = 'tab-1:leaf-1'
    const launchToken = 'launch-token-1'
    const providerSession = { key: 'session_id' as const, id: 'codex-session-1' }

    testStore.setState({
      tabsByWorktree: {
        'wt-1': [makeTab({ id: 'tab-1', worktreeId: 'wt-1' })]
      }
    } as Partial<AppState>)
    testStore.getState().registerAgentLaunchConfig(
      paneKey,
      {
        agentArgs: YOLO_TUI_AGENT_ARGS.codex ?? '',
        agentEnv: {}
      },
      { agentType: 'codex', launchToken, tabId: 'tab-1', leafId: 'leaf-1' }
    )
    testStore
      .getState()
      .setAgentStatus(
        paneKey,
        { state: 'waiting', prompt: 'implement notifications', agentType: 'codex' },
        'Codex',
        { updatedAt: 10, stateStartedAt: 10 },
        { tabId: 'tab-1', worktreeId: 'wt-1' },
        { providerSession, launchToken }
      )

    expect(
      isAutoApprovedCodexPermissionStatus(
        { state: 'waiting', prompt: 'implement notifications', agentType: 'codex' },
        paneKey
      )
    ).toBe(true)
  })

  it('preserves notifications when the live status has no resolvable launch config', () => {
    const paneKey = 'tab-1:leaf-1'

    testStore.getState().setAgentStatus(paneKey, {
      state: 'waiting',
      prompt: 'implement notifications',
      agentType: 'codex'
    })

    expect(
      isAutoApprovedCodexPermissionStatus(
        { state: 'waiting', prompt: 'implement notifications', agentType: 'codex' },
        paneKey
      )
    ).toBe(false)
  })
})

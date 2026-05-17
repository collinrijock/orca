import { describe, expect, it } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import { buildOnboardingFolderAgentStartup } from './onboarding-folder-agent-startup'

describe('buildOnboardingFolderAgentStartup', () => {
  it('queues the persisted default agent with onboarding telemetry', () => {
    const startup = buildOnboardingFolderAgentStartup({
      ...getDefaultSettings('/tmp/orca-workspaces'),
      defaultTuiAgent: 'codex'
    })

    expect(startup).toEqual({
      command: 'codex',
      telemetry: {
        agent_kind: 'codex',
        launch_source: 'onboarding',
        request_kind: 'new'
      }
    })
  })

  it('respects the blank terminal preference', () => {
    const startup = buildOnboardingFolderAgentStartup({
      ...getDefaultSettings('/tmp/orca-workspaces'),
      defaultTuiAgent: 'blank'
    })

    expect(startup).toBeUndefined()
  })

  it('does not infer an agent from auto mode', () => {
    const startup = buildOnboardingFolderAgentStartup({
      ...getDefaultSettings('/tmp/orca-workspaces'),
      defaultTuiAgent: null
    })

    expect(startup).toBeUndefined()
  })
})

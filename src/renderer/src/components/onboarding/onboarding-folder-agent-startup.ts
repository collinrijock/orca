import { buildAgentStartupPlan } from '@/lib/tui-agent-startup'
import { CLIENT_PLATFORM } from '@/lib/new-workspace'
import { tuiAgentToAgentKind } from '@/lib/telemetry'
import type { AgentStartedTelemetry } from '@/lib/worktree-activation'
import type { GlobalSettings } from '../../../../shared/types'

export type OnboardingFolderAgentStartup = {
  command: string
  env?: Record<string, string>
  telemetry: AgentStartedTelemetry
}

export function buildOnboardingFolderAgentStartup(
  settings: GlobalSettings | null
): OnboardingFolderAgentStartup | undefined {
  const agent = settings?.defaultTuiAgent
  if (!settings || !agent || agent === 'blank') {
    return undefined
  }

  const startupPlan = buildAgentStartupPlan({
    agent,
    prompt: '',
    cmdOverrides: settings.agentCmdOverrides ?? {},
    platform: CLIENT_PLATFORM,
    allowEmptyPromptLaunch: true
  })
  if (!startupPlan) {
    return undefined
  }

  return {
    command: startupPlan.launchCommand,
    ...(startupPlan.env ? { env: startupPlan.env } : {}),
    telemetry: {
      agent_kind: tuiAgentToAgentKind(agent),
      launch_source: 'onboarding',
      request_kind: 'new'
    }
  }
}

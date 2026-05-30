import type { FeatureInteractionState } from '../../../../shared/feature-interactions'
import {
  FEATURE_WALL_SETUP_STEPS,
  type FeatureWallSetupStepId
} from '../../../../shared/feature-wall-setup-steps'
import type { GlobalSettings, TerminalTab, Worktree } from '../../../../shared/types'
import { getAgentLabel } from '../../lib/agent-status'

export type FeatureWallSetupProgressInput = {
  settings: GlobalSettings | null
  featureInteractions: FeatureInteractionState
  hasConnectedTaskSource: boolean
  browserUseSkillInstalled: boolean
  computerUseSkillInstalled: boolean
  computerUsePermissionsReady: boolean
  orchestrationSkillInstalled: boolean
  gitRepoCount: number
  worktreesByRepo: Record<string, Worktree[]>
  tabsByWorktree: Record<string, TerminalTab[]>
  runtimePaneTitlesByTabId: Record<string, Record<number, string>>
  hasSetupScript: boolean
}

export type FeatureWallSetupProgress = {
  stepDone: Record<FeatureWallSetupStepId, boolean>
  coreDoneCount: number
  coreTotal: number
}

function hasTwoAgentSessionsInOneWorktree(input: FeatureWallSetupProgressInput): boolean {
  for (const [worktreeId, tabs] of Object.entries(input.tabsByWorktree)) {
    if (
      !Object.values(input.worktreesByRepo).some((worktrees) =>
        worktrees.some((w) => w.id === worktreeId)
      )
    ) {
      continue
    }
    let agentSessionCount = 0
    for (const tab of tabs) {
      const paneTitles = input.runtimePaneTitlesByTabId[tab.id]
      if (paneTitles && Object.keys(paneTitles).length > 0) {
        agentSessionCount += Object.values(paneTitles).filter((title) =>
          getAgentLabel(title)
        ).length
      } else if (getAgentLabel(tab.title)) {
        agentSessionCount += 1
      }
      if (agentSessionCount >= 2) {
        return true
      }
    }
  }
  return false
}

function countWorkspaces(worktreesByRepo: Record<string, Worktree[]>): number {
  return Object.values(worktreesByRepo).reduce((sum, worktrees) => sum + worktrees.length, 0)
}

export function getFeatureWallSetupProgress(
  input: FeatureWallSetupProgressInput
): FeatureWallSetupProgress {
  const agentCapabilitiesDone =
    input.browserUseSkillInstalled &&
    input.computerUseSkillInstalled &&
    input.computerUsePermissionsReady &&
    input.orchestrationSkillInstalled
  const stepDone: Record<FeatureWallSetupStepId, boolean> = {
    'default-agent':
      Boolean(input.settings?.defaultTuiAgent) && input.settings?.defaultTuiAgent !== 'blank',
    'add-two-repos': input.gitRepoCount >= 2,
    notifications:
      input.settings?.notifications.enabled === true &&
      input.settings.notifications.agentTaskComplete === true,
    'two-agents': hasTwoAgentSessionsInOneWorktree(input),
    'three-workspaces': countWorkspaces(input.worktreesByRepo) >= 2,
    'task-sources': input.hasConnectedTaskSource,
    'agent-capabilities': agentCapabilitiesDone,
    'setup-script': input.hasSetupScript
  }
  return {
    stepDone,
    coreDoneCount: FEATURE_WALL_SETUP_STEPS.filter((step) => stepDone[step.id]).length,
    coreTotal: FEATURE_WALL_SETUP_STEPS.length
  }
}

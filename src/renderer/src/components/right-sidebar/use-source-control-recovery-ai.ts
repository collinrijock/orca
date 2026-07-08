import { useCallback, useMemo, useState } from 'react'
import type { GitStatusEntry } from '../../../../shared/types'
import type {
  SourceControlActionRecipe,
  SourceControlLaunchActionId
} from '../../../../shared/source-control-ai-actions'
import { buildFixCommitFailurePrompt, buildFixPushFailurePrompt } from './source-control-ai-prompts'
import { summarizeCommitFailure } from './commit-failure-summary'
import { isPushHookFailure, summarizePushFailure } from './push-failure-summary'
import { launchCommitFailureAgentWithDefault } from './source-control-ai-commit-failure-launch'
import { launchPushFailureAgentWithDefault } from './source-control-ai-push-failure-launch'
import type { SourceControlAiStoreSnapshot } from './source-control-ai-controller-types'

type SourceControlRecoveryAiParams = {
  activeWorktreeId: string | null | undefined
  activeConnectionId: string | null | undefined
  activeGroupId: string | null | undefined
  activeSourceControlLaunchPlatform: NodeJS.Platform
  sourceRepoConnectionId?: string | null
  worktreePath: string | null
  commitMessage: string
  commitError: string | null
  pushFailureRawError: string | null
  pushFailureEntries: Pick<GitStatusEntry, 'path' | 'status' | 'area'>[]
  branchName: string | null
  stagedEntries: Pick<GitStatusEntry, 'path' | 'status' | 'area'>[]
  getLaunchActionRecipe: (actionId: SourceControlLaunchActionId) => SourceControlActionRecipe
  getStoreState: () => SourceControlAiStoreSnapshot
}

export function useSourceControlRecoveryAi({
  activeWorktreeId,
  activeConnectionId,
  activeGroupId,
  activeSourceControlLaunchPlatform,
  sourceRepoConnectionId,
  worktreePath,
  commitMessage,
  commitError,
  pushFailureRawError,
  pushFailureEntries,
  branchName,
  stagedEntries,
  getLaunchActionRecipe,
  getStoreState
}: SourceControlRecoveryAiParams) {
  const [isLaunchingCommitFailureAgent, setIsLaunchingCommitFailureAgent] = useState(false)
  const [isLaunchingPushFailureAgent, setIsLaunchingPushFailureAgent] = useState(false)

  const commitFailureRecoveryPrompt = useMemo(
    () =>
      commitError
        ? buildFixCommitFailurePrompt({
            summary: summarizeCommitFailure(commitError),
            error: commitError,
            entries: stagedEntries,
            worktreePath,
            commitMessage
          })
        : null,
    [commitError, commitMessage, stagedEntries, worktreePath]
  )
  const pushFailureRecoveryPrompt = useMemo(
    () =>
      pushFailureRawError && isPushHookFailure(pushFailureRawError)
        ? buildFixPushFailurePrompt({
            summary: summarizePushFailure(pushFailureRawError),
            error: pushFailureRawError,
            entries: pushFailureEntries,
            worktreePath,
            branchName
          })
        : null,
    [branchName, pushFailureEntries, pushFailureRawError, worktreePath]
  )

  const handleFixCommitFailureWithAI = useCallback(
    async (promptOverride?: string): Promise<boolean> => {
      if (isLaunchingCommitFailureAgent || !activeWorktreeId || !commitError) {
        return false
      }

      setIsLaunchingCommitFailureAgent(true)
      try {
        return await launchCommitFailureAgentWithDefault({
          activeWorktreeId,
          activeGroupId,
          activeSourceControlLaunchPlatform,
          sourceRepoConnectionId: activeConnectionId ?? sourceRepoConnectionId ?? null,
          commitFailureRecoveryPrompt,
          promptOverride,
          getLaunchActionRecipe,
          getStoreState
        })
      } finally {
        setIsLaunchingCommitFailureAgent(false)
      }
    },
    [
      activeGroupId,
      activeConnectionId,
      activeWorktreeId,
      activeSourceControlLaunchPlatform,
      commitError,
      commitFailureRecoveryPrompt,
      getLaunchActionRecipe,
      getStoreState,
      isLaunchingCommitFailureAgent,
      sourceRepoConnectionId
    ]
  )

  const handleFixPushFailureWithAI = useCallback(
    async (promptOverride?: string): Promise<boolean> => {
      if (isLaunchingPushFailureAgent || !activeWorktreeId || !pushFailureRawError) {
        return false
      }

      setIsLaunchingPushFailureAgent(true)
      try {
        return await launchPushFailureAgentWithDefault({
          activeWorktreeId,
          activeGroupId,
          activeSourceControlLaunchPlatform,
          sourceRepoConnectionId: activeConnectionId ?? sourceRepoConnectionId ?? null,
          pushFailureRecoveryPrompt,
          promptOverride,
          getLaunchActionRecipe,
          getStoreState
        })
      } finally {
        setIsLaunchingPushFailureAgent(false)
      }
    },
    [
      activeGroupId,
      activeConnectionId,
      activeWorktreeId,
      activeSourceControlLaunchPlatform,
      getLaunchActionRecipe,
      getStoreState,
      isLaunchingPushFailureAgent,
      pushFailureRawError,
      pushFailureRecoveryPrompt,
      sourceRepoConnectionId
    ]
  )

  return {
    isLaunchingCommitFailureAgent,
    isLaunchingPushFailureAgent,
    commitFailureRecoveryPrompt,
    pushFailureRecoveryPrompt,
    handleFixCommitFailureWithAI,
    handleFixPushFailureWithAI
  }
}

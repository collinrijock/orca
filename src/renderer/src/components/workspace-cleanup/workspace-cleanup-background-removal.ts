import { toast } from 'sonner'
import type { WorkspaceCleanupCandidate } from '../../../../shared/workspace-cleanup'
import {
  isPathInsideOrEqual,
  normalizeRuntimePathForComparison
} from '../../../../shared/cross-platform-path'
import type {
  WorkspaceCleanupFailure,
  WorkspaceCleanupRemoveResult
} from '@/store/slices/workspace-cleanup'
import { translate } from '@/i18n/i18n'

const DEFAULT_WORKSPACE_CLEANUP_REMOVAL_TIMEOUT_MS = 120_000

export type WorkspaceCleanupRemovalProgress = {
  totalCount: number
  processedCount: number
  removedCount: number
  failedCount: number
}

export type WorkspaceCleanupBackgroundRemovalArgs = {
  candidates: readonly WorkspaceCleanupCandidate[]
  removeCandidates: (worktreeIds: readonly string[]) => Promise<WorkspaceCleanupRemoveResult>
  onProgress: (progress: WorkspaceCleanupRemovalProgress) => void
  onResult?: (result: WorkspaceCleanupRemoveResult) => void
  onError?: (error: unknown) => void
  removalTimeoutMs?: number
}

export function startWorkspaceCleanupBackgroundRemoval({
  candidates,
  removeCandidates,
  onProgress,
  onResult,
  onError,
  removalTimeoutMs = DEFAULT_WORKSPACE_CLEANUP_REMOVAL_TIMEOUT_MS
}: WorkspaceCleanupBackgroundRemovalArgs): void {
  if (candidates.length === 0) {
    try {
      onResult?.({ removedIds: [], failures: [] })
    } catch (callbackError) {
      console.error('Workspace cleanup result callback failed', callbackError)
    }
    return
  }

  const count = candidates.length
  const removedIds: string[] = []
  const failures: WorkspaceCleanupFailure[] = []
  const failedCandidates: WorkspaceCleanupCandidate[] = []
  let processedCount = 0

  const emitProgress = (): void => {
    onProgress({
      totalCount: count,
      processedCount,
      removedCount: removedIds.length,
      failedCount: failures.length
    })
  }

  emitProgress()

  // Why: keep the store's nested-worktree delete invariant even though progress
  // is emitted per row; children must be removed before parent workspaces.
  const candidatesInRemovalOrder = [...candidates].sort((a, b) => b.path.length - a.path.length)

  void (async () => {
    for (const candidate of candidatesInRemovalOrder) {
      if (
        failedCandidates.some((failedCandidate) =>
          isStrictWorkspaceCleanupDescendant(candidate, failedCandidate)
        )
      ) {
        failedCandidates.push(candidate)
        failures.push({
          worktreeId: candidate.worktreeId,
          displayName: candidate.displayName,
          message: translate(
            'auto.components.workspace.cleanup.backgroundRemoval.skippedAncestor',
            'Skipped because a nested workspace could not be removed.'
          )
        })
        processedCount += 1
        emitProgress()
        continue
      }
      try {
        const result = await withWorkspaceCleanupRemovalTimeout(
          removeCandidates([candidate.worktreeId]),
          candidate,
          removalTimeoutMs
        )
        removedIds.push(...result.removedIds)
        failures.push(...result.failures)
        if (result.failures.length > 0) {
          failedCandidates.push(candidate)
        }
      } catch (error: unknown) {
        failedCandidates.push(candidate)
        failures.push({
          worktreeId: candidate.worktreeId,
          displayName: candidate.displayName,
          message: error instanceof Error ? error.message : String(error)
        })
      } finally {
        processedCount += 1
        emitProgress()
      }
    }

    const result = { removedIds, failures }
    try {
      onResult?.(result)
    } catch (callbackError) {
      console.error('Workspace cleanup result callback failed', callbackError)
    }

    if (result.removedIds.length > 0) {
      toast.success(
        translate(
          'auto.components.workspace.cleanup.backgroundRemoval.removed',
          'Removed workspaces: {{value0}}',
          {
            value0: result.removedIds.length
          }
        )
      )
    }

    if (result.failures.length > 0) {
      toast.error(
        translate(
          'auto.components.workspace.cleanup.backgroundRemoval.failed',
          'Workspaces not removed: {{value0}}',
          {
            value0: result.failures.length
          }
        ),
        {
          description: result.failures.map((failure) => failure.message).join('; ')
        }
      )
    }
  })().catch((error: unknown) => {
    onError?.(error)
    toast.error(
      translate(
        'auto.components.workspace.cleanup.backgroundRemoval.error',
        'Workspace cleanup failed'
      ),
      {
        description: error instanceof Error ? error.message : String(error)
      }
    )
  })
}

async function withWorkspaceCleanupRemovalTimeout(
  promise: Promise<WorkspaceCleanupRemoveResult>,
  candidate: WorkspaceCleanupCandidate,
  timeoutMs: number
): Promise<WorkspaceCleanupRemoveResult> {
  if (timeoutMs <= 0 || !Number.isFinite(timeoutMs)) {
    return promise
  }

  let timeout: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<WorkspaceCleanupRemoveResult>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(
            new Error(
              translate(
                'auto.components.workspace.cleanup.backgroundRemoval.timedOut',
                'Timed out removing {{value0}}.',
                { value0: candidate.displayName }
              )
            )
          )
        }, timeoutMs)
      })
    ])
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
  }
}

function isStrictWorkspaceCleanupDescendant(
  parent: WorkspaceCleanupCandidate,
  child: WorkspaceCleanupCandidate
): boolean {
  return (
    parent.connectionId === child.connectionId &&
    isStrictWorkspaceCleanupDescendantPath(parent.path, child.path)
  )
}

function isStrictWorkspaceCleanupDescendantPath(parentPath: string, childPath: string): boolean {
  return (
    normalizeRuntimePathForComparison(parentPath) !==
      normalizeRuntimePathForComparison(childPath) && isPathInsideOrEqual(parentPath, childPath)
  )
}

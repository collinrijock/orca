import {
  ALL_EXECUTION_HOSTS_SCOPE,
  getRepoExecutionHostId,
  type ExecutionHostId,
  type ExecutionHostScope
} from '../execution-host'
import type { Repo, TerminalTab, Worktree, WorktreeLineage } from '../types'
import { isInactiveWorkspace } from './workspace-terminal-liveness'

export function isDefaultBranchWorkspace(worktree: Worktree): boolean {
  return worktree.isMainWorktree && worktree.branch.trim() !== ''
}

export function isAutomationGeneratedWorkspace(worktree: Worktree): boolean {
  return worktree.automationProvenance?.kind === 'created-by-automation'
}

function getAllWorktrees(worktreesByRepo: Record<string, Worktree[]>): Worktree[] {
  return Object.values(worktreesByRepo).flat()
}

export function computeVisibleWorktreeIds(
  worktreesByRepo: Record<string, Worktree[]>,
  sortedIds: string[],
  opts: {
    filterRepoIds: readonly string[]
    showSleepingWorkspaces: boolean
    tabsByWorktree: Record<string, Pick<TerminalTab, 'id'>[]> | null
    ptyIdsByTabId: Record<string, string[]> | null
    browserTabsByWorktree?: Record<string, { id: string }[]> | null
    // Why required: every filter caller must preserve running agents through
    // temporary PTY gaps instead of silently reverting #7197.
    worktreeIdsWithLiveAgent: ReadonlySet<string>
    hideDefaultBranchWorkspace: boolean
    hideAutomationGeneratedWorkspaces: boolean
    repoMap: Map<string, Repo>
    workspaceHostScope: ExecutionHostScope
    visibleWorkspaceHostIds?: readonly ExecutionHostId[] | null
    defaultHostId: ExecutionHostId
    worktreeLineageById: Record<string, WorktreeLineage>
  }
): string[] {
  let all = getAllWorktrees(worktreesByRepo).filter((w) => !w.isArchived)
  const lineageAncestorById = new Map(all.map((w) => [w.id, w]))

  if (opts.hideDefaultBranchWorkspace) {
    all = all.filter((w) => !isDefaultBranchWorkspace(w))
  }

  if (opts.hideAutomationGeneratedWorkspaces) {
    all = all.filter((w) => !isAutomationGeneratedWorkspace(w))
  }

  const visibleHostIds =
    opts.visibleWorkspaceHostIds ??
    (opts.workspaceHostScope === ALL_EXECUTION_HOSTS_SCOPE ? null : [opts.workspaceHostScope])
  if (visibleHostIds) {
    const visibleHostIdSet = new Set(visibleHostIds)
    all = all.filter((w) => {
      const repo = opts.repoMap.get(w.repoId)
      if (!repo) {
        return false
      }
      const hostId =
        repo.connectionId || repo.executionHostId
          ? getRepoExecutionHostId(repo)
          : opts.defaultHostId
      return visibleHostIdSet.has(hostId)
    })
  }

  if (opts.filterRepoIds.length > 0) {
    const selectedRepoIds = new Set(opts.filterRepoIds)
    all = all.filter((w) => selectedRepoIds.has(w.repoId))
  }

  if (!opts.showSleepingWorkspaces) {
    all = all.filter(
      (w) =>
        !isInactiveWorkspace(
          w.id,
          opts.tabsByWorktree,
          opts.ptyIdsByTabId,
          opts.browserTabsByWorktree,
          opts.worktreeIdsWithLiveAgent
        )
    )
  }

  const orderIndex = new Map(sortedIds.map((id, i) => [id, i]))
  all.sort((a, b) => {
    const ai = orderIndex.get(a.id) ?? Infinity
    const bi = orderIndex.get(b.id) ?? Infinity
    return ai - bi
  })

  return addVisibleLineageAncestors(
    all.map((w) => w.id),
    lineageAncestorById,
    opts.worktreeLineageById
  )
}

function addVisibleLineageAncestors(
  ids: string[],
  worktreeById: Map<string, Worktree>,
  lineageById: Record<string, WorktreeLineage>
): string[] {
  const result: string[] = []
  const included = new Set<string>()
  const visiting = new Set<string>()

  const addWithAncestors = (id: string): void => {
    if (included.has(id) || visiting.has(id)) {
      return
    }
    const worktree = worktreeById.get(id)
    if (!worktree) {
      return
    }
    visiting.add(id)
    const lineage = lineageById[id]
    const parent = lineage ? worktreeById.get(lineage.parentWorktreeId) : undefined
    if (
      parent &&
      worktree.instanceId === lineage.worktreeInstanceId &&
      parent.instanceId === lineage.parentWorktreeInstanceId
    ) {
      addWithAncestors(parent.id)
    }
    visiting.delete(id)
    if (!included.has(id)) {
      included.add(id)
      result.push(id)
    }
  }

  for (const id of ids) {
    addWithAncestors(id)
  }
  return result
}

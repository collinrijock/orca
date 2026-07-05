import type { Repo, Worktree, WorktreeLineage } from '../types'
import type { WorkspaceItemRow, WorkspaceSectionRow } from './workspace-list-model'
import { getLineageGroupKey } from './workspace-section-constants'

export type LineageRenderInfo =
  | { state: 'none' }
  | { state: 'valid'; lineage: WorktreeLineage; parent: Worktree }
  | { state: 'missing'; lineage: WorktreeLineage }

export function getLineageRenderInfo(
  worktree: Worktree,
  lineageById: Record<string, WorktreeLineage>,
  worktreeMap: Map<string, Worktree>
): LineageRenderInfo {
  const lineage = lineageById[worktree.id]
  if (!lineage) {
    return { state: 'none' }
  }
  const parent = worktreeMap.get(lineage.parentWorktreeId)
  if (
    !parent ||
    worktree.instanceId !== lineage.worktreeInstanceId ||
    parent.instanceId !== lineage.parentWorktreeInstanceId
  ) {
    return { state: 'missing', lineage }
  }
  return { state: 'valid', lineage, parent }
}

export function buildWorktreeRow(
  worktree: Worktree,
  repoMap: Map<string, Repo>,
  options: {
    rowKey: string
    sectionKey: string
    depth: number
    groupDepth: number
    lineageTrail: boolean[]
    isLastLineageChild: boolean
    lineageChildCount: number
    lineageCollapsed: boolean
    hostContextLabel?: string
  }
): WorkspaceItemRow {
  return {
    type: 'item',
    rowKey: options.rowKey,
    sectionKey: options.sectionKey,
    worktree,
    repo: repoMap.get(worktree.repoId),
    depth: options.depth,
    groupDepth: options.groupDepth,
    lineageTrail: options.lineageTrail,
    isLastLineageChild: options.isLastLineageChild,
    lineageChildCount: options.lineageChildCount,
    ...(options.hostContextLabel ? { hostContextLabel: options.hostContextLabel } : {}),
    ...(options.lineageChildCount > 0 ? { lineageGroupKey: getLineageGroupKey(worktree.id) } : {}),
    ...(options.lineageChildCount > 0 ? { lineageCollapsed: options.lineageCollapsed } : {})
  }
}

export function appendWorktreeRows(
  result: WorkspaceSectionRow[],
  worktrees: Worktree[],
  repoMap: Map<string, Repo>,
  lineageById: Record<string, WorktreeLineage>,
  worktreeMap: Map<string, Worktree>,
  options: {
    nestLineage: boolean
    collapsedGroups: Set<string>
    groupDepth: number
    sectionKey: string
    hostContextLabelByRepoId?: ReadonlyMap<string, string>
  }
): void {
  const { nestLineage, collapsedGroups, groupDepth, sectionKey, hostContextLabelByRepoId } = options
  if (!nestLineage) {
    for (const worktree of worktrees) {
      result.push(
        buildWorktreeRow(worktree, repoMap, {
          rowKey: `${sectionKey}:${worktree.id}`,
          sectionKey,
          depth: 0,
          groupDepth,
          lineageTrail: [],
          isLastLineageChild: false,
          lineageChildCount: 0,
          lineageCollapsed: false,
          hostContextLabel: hostContextLabelByRepoId?.get(worktree.repoId)
        })
      )
    }
    return
  }

  const visibleIds = new Set(worktrees.map((worktree) => worktree.id))
  const childrenByParentId = new Map<string, Worktree[]>()
  const childIds = new Set<string>()
  for (const worktree of worktrees) {
    const lineage = getLineageRenderInfo(worktree, lineageById, worktreeMap)
    if (lineage.state !== 'valid' || !visibleIds.has(lineage.parent.id)) {
      continue
    }
    childIds.add(worktree.id)
    const children = childrenByParentId.get(lineage.parent.id) ?? []
    children.push(worktree)
    childrenByParentId.set(lineage.parent.id, children)
  }

  const emitted = new Set<string>()
  const emit = (
    worktree: Worktree,
    depth: number,
    lineageTrail: boolean[],
    isLastChild: boolean
  ): void => {
    if (emitted.has(worktree.id)) {
      return
    }
    const children = childrenByParentId.get(worktree.id) ?? []
    const lineageCollapsed = collapsedGroups.has(getLineageGroupKey(worktree.id))
    emitted.add(worktree.id)
    result.push(
      buildWorktreeRow(worktree, repoMap, {
        rowKey: `${sectionKey}:${worktree.id}`,
        sectionKey,
        depth,
        groupDepth,
        lineageTrail,
        isLastLineageChild: isLastChild,
        lineageChildCount: children.length,
        lineageCollapsed,
        hostContextLabel: hostContextLabelByRepoId?.get(worktree.repoId)
      })
    )
    if (lineageCollapsed) {
      return
    }
    children.forEach((child, index) => {
      emit(
        child,
        depth + 1,
        [...lineageTrail, index < children.length - 1],
        index === children.length - 1
      )
    })
  }

  const roots = worktrees.filter((worktree) => !childIds.has(worktree.id))
  for (const [index, worktree] of roots.entries()) {
    emit(worktree, 0, [], index === roots.length - 1)
  }
  if (roots.length === 0) {
    for (const worktree of worktrees) {
      if (!emitted.has(worktree.id)) {
        emit(worktree, 0, [], true)
      }
    }
  }
}

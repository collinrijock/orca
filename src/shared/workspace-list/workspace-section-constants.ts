import { UNGROUPED_PROJECT_GROUP_KEY } from '../project-groups'

export type WorktreeGroupBy = 'none' | 'workspace-status' | 'repo' | 'pr-status'

export const PINNED_GROUP_KEY = 'pinned'
export const ALL_GROUP_KEY = 'all'
export const LINEAGE_GROUP_PREFIX = 'lineage:'

export function getLineageGroupKey(worktreeId: string): string {
  return `${LINEAGE_GROUP_PREFIX}${worktreeId}`
}

export function getProjectGroupHeaderKey(groupId: string | null): string {
  return groupId ? `project-group:${groupId}` : UNGROUPED_PROJECT_GROUP_KEY
}

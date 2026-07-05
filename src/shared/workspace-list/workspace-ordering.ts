import type { AgentStatusEntry, MigrationUnsupportedPtyEntry } from '../agent-status-types'
import type { Repo, TerminalLayoutSnapshot, TerminalTab, Worktree } from '../types'
import {
  buildAttentionByWorktree,
  hasFreshAttributedAgentStatus,
  IDLE,
  type WorktreeAttention
} from './workspace-attention'
import type { WorkspaceListSortBy } from './workspace-list-model'
import { tabHasLivePty } from './workspace-terminal-liveness'

export type SortBy = WorkspaceListSortBy

export const CREATE_GRACE_MS = 5 * 60 * 1000

export function effectiveRecentActivity(worktree: Worktree, now: number): number {
  const { lastActivityAt, createdAt } = worktree
  if (createdAt === undefined || now >= createdAt + CREATE_GRACE_MS) {
    return lastActivityAt
  }
  return Math.max(lastActivityAt, createdAt + CREATE_GRACE_MS)
}

type WorktreeSortLabelInput = Pick<Worktree, 'displayName' | 'path' | 'id'>

function pathBasename(path: string): string {
  const normalized = path.replace(/[\\/]+$/g, '')
  const index = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
  return index >= 0 ? normalized.slice(index + 1) : normalized
}

export function getWorktreeSortLabel(worktree: WorktreeSortLabelInput): string {
  const displayName = typeof worktree.displayName === 'string' ? worktree.displayName.trim() : ''
  if (displayName) {
    return displayName
  }
  const pathLabel = typeof worktree.path === 'string' ? pathBasename(worktree.path).trim() : ''
  return pathLabel || worktree.id
}

export function compareWorktreeSortLabel(
  a: WorktreeSortLabelInput,
  b: WorktreeSortLabelInput
): number {
  return getWorktreeSortLabel(a).localeCompare(getWorktreeSortLabel(b))
}

export function buildWorktreeComparator(
  sortBy: SortBy,
  repoMap: Map<string, Repo>,
  now: number,
  attentionByWorktree: Map<string, WorktreeAttention>
): (a: Worktree, b: Worktree) => number {
  return (a, b) => {
    switch (sortBy) {
      case 'name':
        return compareWorktreeSortLabel(a, b)
      case 'smart': {
        const aw = attentionByWorktree.get(a.id) ?? IDLE
        const bw = attentionByWorktree.get(b.id) ?? IDLE
        return (
          aw.cls - bw.cls ||
          bw.attentionTimestamp - aw.attentionTimestamp ||
          effectiveRecentActivity(b, now) - effectiveRecentActivity(a, now) ||
          compareWorktreeSortLabel(a, b)
        )
      }
      case 'recent':
        return (
          effectiveRecentActivity(b, now) - effectiveRecentActivity(a, now) ||
          compareWorktreeSortLabel(a, b)
        )
      case 'repo': {
        const ra = repoMap.get(a.repoId)?.displayName ?? ''
        const rb = repoMap.get(b.repoId)?.displayName ?? ''
        const cmp = ra.localeCompare(rb)
        return cmp !== 0 ? cmp : compareWorktreeSortLabel(a, b)
      }
      case 'manual':
        return (
          (b.manualOrder ?? b.sortOrder) - (a.manualOrder ?? a.sortOrder) ||
          compareWorktreeSortLabel(a, b)
        )
    }
  }
}

export function sortWorktreesSmart(
  worktrees: Worktree[],
  tabsByWorktree: Record<string, TerminalTab[]>,
  repoMap: Map<string, Repo>,
  agentStatusByPaneKey: Record<string, AgentStatusEntry>,
  runtimePaneTitlesByTabId: Record<string, Record<number, string>>,
  ptyIdsByTabId: Record<string, string[]>,
  migrationUnsupportedByPtyId?: Record<string, MigrationUnsupportedPtyEntry>,
  terminalLayoutsByTabId?: Record<string, TerminalLayoutSnapshot>
): Worktree[] {
  const hasAnyLivePty = Object.values(tabsByWorktree)
    .flat()
    .some((tab) => tabHasLivePty(ptyIdsByTabId, tab.id))

  const now = Date.now()
  if (!hasAnyLivePty && !hasFreshAttributedAgentStatus(agentStatusByPaneKey, now, tabsByWorktree)) {
    return [...worktrees].sort(
      (a, b) => b.sortOrder - a.sortOrder || compareWorktreeSortLabel(a, b)
    )
  }

  const attentionByWorktree = buildAttentionByWorktree(
    worktrees,
    tabsByWorktree,
    agentStatusByPaneKey,
    runtimePaneTitlesByTabId,
    ptyIdsByTabId,
    now,
    migrationUnsupportedByPtyId,
    terminalLayoutsByTabId
  )

  return [...worktrees].sort(buildWorktreeComparator('smart', repoMap, now, attentionByWorktree))
}

export function deriveSortedWorktreeIds(args: {
  worktrees: Worktree[]
  sortBy: SortBy
  repoMap: Map<string, Repo>
  now: number
  tabsByWorktree?: Record<string, TerminalTab[]> | null
  agentStatusByPaneKey?: Record<string, AgentStatusEntry>
  runtimePaneTitlesByTabId?: Record<string, Record<number, string>>
  ptyIdsByTabId?: Record<string, string[]> | null
  migrationUnsupportedByPtyId?: Record<string, MigrationUnsupportedPtyEntry>
  terminalLayoutsByTabId?: Record<string, TerminalLayoutSnapshot | undefined>
}): string[] {
  const worktrees = [...args.worktrees]
  const ptyIdsByTabId = args.ptyIdsByTabId ?? {}
  const tabsByWorktree = args.tabsByWorktree ?? {}
  const attentionByWorktree =
    args.sortBy === 'smart'
      ? buildAttentionByWorktree(
          worktrees,
          tabsByWorktree,
          args.agentStatusByPaneKey ?? {},
          args.runtimePaneTitlesByTabId ?? {},
          ptyIdsByTabId,
          args.now,
          args.migrationUnsupportedByPtyId,
          args.terminalLayoutsByTabId
        )
      : new Map<string, WorktreeAttention>()

  if (args.sortBy === 'smart') {
    const hasAnyLivePty = Object.values(tabsByWorktree)
      .flat()
      .some((tab) => tabHasLivePty(ptyIdsByTabId, tab.id))
    if (
      !hasAnyLivePty &&
      !hasFreshAttributedAgentStatus(args.agentStatusByPaneKey, args.now, tabsByWorktree)
    ) {
      worktrees.sort((a, b) => b.sortOrder - a.sortOrder || compareWorktreeSortLabel(a, b))
      return worktrees.map((worktree) => worktree.id)
    }
  }

  worktrees.sort(buildWorktreeComparator(args.sortBy, args.repoMap, args.now, attentionByWorktree))
  return worktrees.map((worktree) => worktree.id)
}

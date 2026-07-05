import { detectAgentStatusFromTitle } from '../agent-detection'
import type { AgentStatus } from '../agent-detection'
import {
  AGENT_STATUS_STALE_AFTER_MS,
  type AgentStateHistoryEntry,
  type AgentStatusEntry,
  type MigrationUnsupportedPtyEntry
} from '../agent-status-types'
import { parsePaneKey } from '../stable-pane-id'
import type { TerminalLayoutSnapshot, TerminalTab, Worktree } from '../types'
import { isExplicitAgentStatusFresh } from './workspace-agent-status-freshness'
import { migrationUnsupportedToAgentStatusEntry } from './workspace-migration-agent-entry'
import { resolveRuntimePaneTitleLeafId } from './workspace-runtime-pane-title'
import { tabHasLivePty } from './workspace-terminal-liveness'

export type SmartClass = 1 | 2 | 3 | 4
export type AttentionCause = 'blocked' | 'waiting' | 'title-heuristic'

export type WorktreeAttention = {
  cls: SmartClass
  attentionTimestamp: number
  cause?: AttentionCause
}

export const IDLE: WorktreeAttention = { cls: 4, attentionTimestamp: 0 }

export function hasFreshAttributedAgentStatus(
  agentStatusByPaneKey: Record<string, AgentStatusEntry> | undefined,
  now: number,
  tabsByWorktree: Record<string, TerminalTab[]>
): boolean {
  const freshUnstampedTabIds = new Set<string>()
  for (const entry of Object.values(agentStatusByPaneKey ?? {})) {
    const parsed = parsePaneKey(entry.paneKey)
    if (parsed === null || !isExplicitAgentStatusFresh(entry, now, AGENT_STATUS_STALE_AFTER_MS)) {
      continue
    }
    if (entry.worktreeId) {
      return true
    }
    // Why: hook rows can omit the redundant stamp while paneKey still maps to
    // a mirrored tab, which is enough to end the Smart cold-start fallback.
    freshUnstampedTabIds.add(parsed.tabId)
  }
  if (freshUnstampedTabIds.size === 0) {
    return false
  }
  return Object.values(tabsByWorktree).some((tabs) =>
    tabs.some((tab) => freshUnstampedTabIds.has(tab.id))
  )
}

export function mostRecentAttentionInHistory(history: AgentStateHistoryEntry[]): number | null {
  let max = 0
  for (const h of history) {
    if (h.state === 'done' && h.interrupted) {
      continue
    }
    if (h.state === 'done' || h.state === 'blocked' || h.state === 'waiting') {
      if (!Number.isFinite(h.startedAt)) {
        continue
      }
      if (h.startedAt > max) {
        max = h.startedAt
      }
    }
  }
  return max > 0 ? max : null
}

export type PaneInput =
  | { kind: 'hook'; entry: AgentStatusEntry }
  | { kind: 'title'; status: AgentStatus | null; worktreeLastActivityAt: number }

export function resolveAttention(panes: PaneInput[], now: number): WorktreeAttention {
  let bestCls: SmartClass = 4
  let bestTs = 0
  let bestCause: AttentionCause | undefined

  for (const pane of panes) {
    let cls: SmartClass
    let ts: number
    let cause: AttentionCause | undefined

    if (pane.kind === 'hook') {
      const entry = pane.entry
      if (!isExplicitAgentStatusFresh(entry, now, AGENT_STATUS_STALE_AFTER_MS)) {
        continue
      }
      if (!Number.isFinite(entry.stateStartedAt)) {
        continue
      }

      if (entry.state === 'blocked' || entry.state === 'waiting') {
        cls = 1
        ts = entry.stateStartedAt
        cause = entry.state
      } else if (entry.state === 'done') {
        if (entry.interrupted) {
          continue
        }
        cls = 2
        ts = entry.stateStartedAt
      } else {
        cls = 3
        const prior = mostRecentAttentionInHistory(entry.stateHistory)
        if (prior === null) {
          ts = entry.stateStartedAt
        } else if (entry.agentType === 'command-code') {
          // Why: Command Code has no UserPromptSubmit hook, so a new prompt while
          // still `working` only advances stateStartedAt (no new history row). It
          // must beat the stale prior-attention timestamp. Other agents keep the
          // prior-attention ordering — their real state transitions already mark
          // the turn boundary, so scoping avoids reordering them.
          ts = Math.max(prior, entry.stateStartedAt)
        } else {
          ts = prior
        }
      }
    } else if (pane.status === 'permission') {
      cls = 1
      ts = now
      cause = 'title-heuristic'
    } else if (pane.status === 'working') {
      cls = 3
      ts = pane.worktreeLastActivityAt
    } else {
      continue
    }

    if (cls < bestCls || (cls === bestCls && ts > bestTs)) {
      bestCls = cls
      bestTs = ts
      bestCause = cause
    }
  }

  return bestCls === 1 && bestCause
    ? { cls: bestCls, attentionTimestamp: bestTs, cause: bestCause }
    : { cls: bestCls, attentionTimestamp: bestTs }
}

export function buildExplicitEntriesByTabId(
  agentStatusByPaneKey: Record<string, AgentStatusEntry> | undefined,
  migrationUnsupportedByPtyId?: Record<string, MigrationUnsupportedPtyEntry>
): Map<string, AgentStatusEntry[]> {
  const byTab = new Map<string, AgentStatusEntry[]>()
  const entries = [
    ...Object.values(agentStatusByPaneKey ?? {}),
    ...Object.values(migrationUnsupportedByPtyId ?? {}).flatMap((entry) => {
      const agentEntry = migrationUnsupportedToAgentStatusEntry(entry)
      return agentEntry ? [agentEntry] : []
    })
  ]
  for (const entry of entries) {
    const parsed = parsePaneKey(entry.paneKey)
    if (!parsed) {
      continue
    }
    const bucket = byTab.get(parsed.tabId)
    if (bucket) {
      bucket.push(entry)
    } else {
      byTab.set(parsed.tabId, [entry])
    }
  }
  return byTab
}

function buildExplicitEntriesByWorktreeId(
  agentStatusByPaneKey: Record<string, AgentStatusEntry> | undefined
): Map<string, AgentStatusEntry[]> {
  const byWorktree = new Map<string, AgentStatusEntry[]>()
  for (const entry of Object.values(agentStatusByPaneKey ?? {})) {
    if (!entry.worktreeId || !parsePaneKey(entry.paneKey)) {
      continue
    }
    const bucket = byWorktree.get(entry.worktreeId)
    if (bucket) {
      bucket.push(entry)
    } else {
      byWorktree.set(entry.worktreeId, [entry])
    }
  }
  return byWorktree
}

function leafIdFromPaneKey(paneKey: string): string | null {
  return parsePaneKey(paneKey)?.leafId ?? null
}

export function buildAttentionByWorktree(
  worktrees: Worktree[],
  tabsByWorktree: Record<string, TerminalTab[]> | null,
  agentStatusByPaneKey: Record<string, AgentStatusEntry> | undefined,
  runtimePaneTitlesByTabId: Record<string, Record<number, string>>,
  ptyIdsByTabId: Record<string, string[]>,
  now: number,
  migrationUnsupportedByPtyId?: Record<string, MigrationUnsupportedPtyEntry>,
  terminalLayoutsByTabId?: Record<string, TerminalLayoutSnapshot | undefined>
): Map<string, WorktreeAttention> {
  const byTab = buildExplicitEntriesByTabId(agentStatusByPaneKey, migrationUnsupportedByPtyId)
  const byAttributedWorktree = buildExplicitEntriesByWorktreeId(agentStatusByPaneKey)
  const mirroredTabIds = new Set(
    Object.values(tabsByWorktree ?? {}).flatMap((tabs) => tabs.map((tab) => tab.id))
  )
  const result = new Map<string, WorktreeAttention>()

  for (const worktree of worktrees) {
    const tabs = tabsByWorktree?.[worktree.id] ?? []
    // Why: hook stamps can arrive before the renderer mirrors a headless or
    // remote tab. Mirrored tab ownership overrides a stale worktree stamp.
    const panes: PaneInput[] = (byAttributedWorktree.get(worktree.id) ?? [])
      .filter((entry) => {
        const parsed = parsePaneKey(entry.paneKey)
        return parsed !== null && !mirroredTabIds.has(parsed.tabId)
      })
      .map((entry) => ({ kind: 'hook' as const, entry }))
    if (tabs.length === 0) {
      result.set(worktree.id, resolveAttention(panes, now))
      continue
    }
    for (const tab of tabs) {
      const hookEntries = byTab.get(tab.id)
      const hookLeafIds = new Set<string>()
      if (hookEntries) {
        for (const entry of hookEntries) {
          panes.push({ kind: 'hook', entry })
          if (!isExplicitAgentStatusFresh(entry, now, AGENT_STATUS_STALE_AFTER_MS)) {
            continue
          }
          const leafId = leafIdFromPaneKey(entry.paneKey)
          if (leafId !== null) {
            hookLeafIds.add(leafId)
          }
        }
      }

      if (!tabHasLivePty(ptyIdsByTabId, tab.id)) {
        continue
      }

      const paneTitles = runtimePaneTitlesByTabId[tab.id]
      if (paneTitles && Object.keys(paneTitles).length > 0) {
        const tabLayout = terminalLayoutsByTabId?.[tab.id]
        for (const [runtimePaneId, title] of Object.entries(paneTitles)) {
          const leafId = resolveRuntimePaneTitleLeafId(tabLayout, runtimePaneId)
          if (leafId !== null && hookLeafIds.has(leafId)) {
            continue
          }
          panes.push({
            kind: 'title',
            status: detectAgentStatusFromTitle(title),
            worktreeLastActivityAt: worktree.lastActivityAt
          })
        }
      } else if (hookLeafIds.size === 0) {
        panes.push({
          kind: 'title',
          status: detectAgentStatusFromTitle(tab.title),
          worktreeLastActivityAt: worktree.lastActivityAt
        })
      }
    }
    result.set(worktree.id, resolveAttention(panes, now))
  }

  return result
}

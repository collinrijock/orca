import type { SleepingAgentSessionRecord } from '../../../../shared/agent-session-resume'
import type { AppState } from '../types'
import { parseRemoteRuntimePtyId } from '@/runtime/runtime-terminal-stream'

export type TerminalTabCloseReason = 'user' | 'cleanup' | 'pty-exit'

type TerminalTabRetirementState = Pick<
  AppState,
  | 'tabsByWorktree'
  | 'unifiedTabsByWorktree'
  | 'ptyIdsByTabId'
  | 'terminalLayoutsByTabId'
  | 'lastKnownRelayPtyIdByTabId'
  | 'deferredSshSessionIdsByTabId'
  | 'pendingReconnectPtyIdByTabId'
>

export type TerminalTabRetirementPlan = {
  tabId: string
  worktreeId: string | null
  ptyIds: string[]
  localOrSshPtyIds: string[]
  runtimeTerminals: {
    ptyId: string
    environmentId: string | null
    handle: string
  }[]
  sharedPtyIds: string[]
  unroutablePtyIds: string[]
}

function appendPtyId(ids: Set<string>, ptyId: string | null | undefined): void {
  if (ptyId) {
    ids.add(ptyId)
  }
}

function collectTerminalTabPtyIds(state: TerminalTabRetirementState, tabId: string): string[] {
  const ids = new Set<string>()
  for (const ptyId of state.ptyIdsByTabId[tabId] ?? []) {
    appendPtyId(ids, ptyId)
  }
  for (const tabs of Object.values(state.tabsByWorktree)) {
    appendPtyId(ids, tabs.find((tab) => tab.id === tabId)?.ptyId)
  }

  for (const ptyId of Object.values(state.terminalLayoutsByTabId[tabId]?.ptyIdsByLeafId ?? {})) {
    appendPtyId(ids, ptyId)
  }
  appendPtyId(ids, state.lastKnownRelayPtyIdByTabId[tabId])
  appendPtyId(ids, state.deferredSshSessionIdsByTabId[tabId])
  appendPtyId(ids, state.pendingReconnectPtyIdByTabId[tabId])
  return [...ids]
}

function referencesPtyFromAnotherTab(
  state: TerminalTabRetirementState,
  closingTabId: string,
  ptyId: string
): boolean {
  for (const tabs of Object.values(state.tabsByWorktree)) {
    if (tabs.some((tab) => tab.id !== closingTabId && tab.ptyId === ptyId)) {
      return true
    }
  }

  const liveTabIds = new Set<string>()
  for (const tabs of Object.values(state.tabsByWorktree)) {
    for (const tab of tabs) {
      liveTabIds.add(tab.id)
    }
  }
  for (const tabs of Object.values(state.unifiedTabsByWorktree)) {
    for (const tab of tabs) {
      if (tab.contentType === 'terminal') {
        liveTabIds.add(tab.entityId)
      }
    }
  }

  const indexedMaps: readonly Record<string, string | string[] | undefined>[] = [
    state.ptyIdsByTabId,
    state.lastKnownRelayPtyIdByTabId,
    state.deferredSshSessionIdsByTabId,
    state.pendingReconnectPtyIdByTabId
  ]
  for (const indexedMap of indexedMaps) {
    for (const [tabId, value] of Object.entries(indexedMap)) {
      if (tabId === closingTabId || !liveTabIds.has(tabId)) {
        continue
      }
      if (Array.isArray(value) ? value.includes(ptyId) : value === ptyId) {
        return true
      }
    }
  }

  for (const [tabId, layout] of Object.entries(state.terminalLayoutsByTabId)) {
    if (
      tabId !== closingTabId &&
      liveTabIds.has(tabId) &&
      Object.values(layout.ptyIdsByLeafId ?? {}).includes(ptyId)
    ) {
      return true
    }
  }
  return false
}

export function isTerminalTabPresent(
  state: Pick<AppState, 'tabsByWorktree'>,
  tabId: string
): boolean {
  return Object.values(state.tabsByWorktree).some((tabs) => tabs.some((tab) => tab.id === tabId))
}

export function buildTerminalTabRetirementPlan(
  state: TerminalTabRetirementState,
  tabId: string
): TerminalTabRetirementPlan {
  const worktreeId =
    Object.entries(state.tabsByWorktree).find(([, tabs]) =>
      tabs.some((tab) => tab.id === tabId)
    )?.[0] ??
    Object.entries(state.unifiedTabsByWorktree).find(([, tabs]) =>
      tabs.some((tab) => tab.contentType === 'terminal' && tab.entityId === tabId)
    )?.[0] ??
    null
  const ptyIds = collectTerminalTabPtyIds(state, tabId)
  const sharedPtyIds: string[] = []
  const localOrSshPtyIds: string[] = []
  const runtimeTerminals: TerminalTabRetirementPlan['runtimeTerminals'] = []
  const unroutablePtyIds: string[] = []

  for (const ptyId of ptyIds) {
    if (referencesPtyFromAnotherTab(state, tabId, ptyId)) {
      sharedPtyIds.push(ptyId)
      continue
    }
    const remote = parseRemoteRuntimePtyId(ptyId)
    if (remote) {
      if (!remote.handle) {
        unroutablePtyIds.push(ptyId)
        continue
      }
      runtimeTerminals.push({
        ptyId,
        environmentId: remote.environmentId?.trim() || null,
        handle: remote.handle
      })
    } else if (ptyId.startsWith('remote:')) {
      unroutablePtyIds.push(ptyId)
    } else {
      localOrSshPtyIds.push(ptyId)
    }
  }

  return {
    tabId,
    worktreeId,
    ptyIds,
    localOrSshPtyIds,
    runtimeTerminals,
    sharedPtyIds,
    unroutablePtyIds
  }
}

export function removeSleepingAgentSessionsForTab(
  records: Record<string, SleepingAgentSessionRecord>,
  tabId: string
): Record<string, SleepingAgentSessionRecord> {
  let next = records
  for (const [paneKey, record] of Object.entries(records)) {
    if (!paneKey.startsWith(`${tabId}:`) && record.tabId !== tabId) {
      continue
    }
    if (next === records) {
      next = { ...records }
    }
    delete next[paneKey]
  }
  return next
}

import { parsePaneKey, parseLegacyNumericPaneKey } from '../../shared/stable-pane-id'
import {
  hasUnknownNestedOwnershipField,
  hasUnknownWorkspaceOwnershipField,
  isRawOwnershipRecord as isRecord
} from './daemon-ownership-raw-field-classification'

const MAX_ID_LENGTH = 512
const MAX_LAYOUT_NODES = 1_024

export type RawTerminalBinding = {
  sessionId: string
  workspaceKey: string
  tabId: string
  leafId: string | null
}

export type RawSleepingRoute = {
  paneKey: string
  tabId: string
  workspaceKey: string
  connectionId: string | null
  joinedSessionId: string | null
}

export type RawWorkspaceOwnership = {
  bindings: RawTerminalBinding[]
  sleepingRoutes: RawSleepingRoute[]
}

export type RawWorkspaceParseResult =
  | { ok: true; value: RawWorkspaceOwnership }
  | { ok: false; reason: 'malformed-workspace' | 'unresolved-sleep-route' | 'unsupported-field' }

type TabRow = { tabId: string; sessionId: string | null; workspaceKey: string }

export function parseRawLocalWorkspace(value: unknown): RawWorkspaceParseResult {
  if (value === undefined) {
    return { ok: true, value: { bindings: [], sleepingRoutes: [] } }
  }
  if (!isRecord(value) || hasUnknownWorkspaceOwnershipField(value)) {
    return {
      ok: false,
      reason: isRecord(value) ? 'unsupported-field' : 'malformed-workspace'
    }
  }
  const tabs = parseTabs(value.tabsByWorktree)
  if (tabs === null) {
    return { ok: false, reason: 'malformed-workspace' }
  }
  const layouts = parseLayouts(value.terminalLayoutsByTabId)
  if (layouts === null) {
    return { ok: false, reason: 'malformed-workspace' }
  }
  const bindings = mergeTabAndLayoutBindings(tabs, layouts)
  if (bindings === null || !validateRemoteMetadata(value)) {
    return { ok: false, reason: 'malformed-workspace' }
  }
  const sleepingRoutes = parseSleepingRoutes(value.sleepingAgentSessionsByPaneKey, bindings)
  if (sleepingRoutes === null) {
    return { ok: false, reason: 'unresolved-sleep-route' }
  }
  return { ok: true, value: { bindings, sleepingRoutes } }
}

export function validateRawRemoteWorkspace(value: unknown): boolean {
  return parseRawLocalWorkspace(value).ok
}

function parseTabs(value: unknown): TabRow[] | null {
  if (value === undefined) {
    return []
  }
  if (!isRecord(value)) {
    return null
  }
  const tabs: TabRow[] = []
  const seenTabIds = new Set<string>()
  for (const [workspaceKey, rawTabs] of Object.entries(value)) {
    if (!isId(workspaceKey) || !Array.isArray(rawTabs)) {
      return null
    }
    for (const rawTab of rawTabs) {
      if (
        !isRecord(rawTab) ||
        hasUnknownNestedOwnershipField(rawTab, 'tab') ||
        !isId(rawTab.id) ||
        seenTabIds.has(rawTab.id)
      ) {
        return null
      }
      if (rawTab.ptyId !== undefined && rawTab.ptyId !== null && !isId(rawTab.ptyId)) {
        return null
      }
      seenTabIds.add(rawTab.id)
      tabs.push({
        tabId: rawTab.id,
        sessionId: typeof rawTab.ptyId === 'string' ? rawTab.ptyId : null,
        workspaceKey
      })
    }
  }
  return tabs
}

function parseLayouts(value: unknown): RawTerminalBinding[] | null {
  if (value === undefined) {
    return []
  }
  if (!isRecord(value)) {
    return null
  }
  const bindings: RawTerminalBinding[] = []
  for (const [tabId, rawLayout] of Object.entries(value)) {
    if (
      !isId(tabId) ||
      !isRecord(rawLayout) ||
      hasUnknownNestedOwnershipField(rawLayout, 'layout')
    ) {
      return null
    }
    const rootLeaves = rawLayout.root === undefined ? null : collectLayoutLeaves(rawLayout.root)
    if (rootLeaves === false) {
      return null
    }
    const ptyIds = rawLayout.ptyIdsByLeafId
    if (ptyIds === undefined) {
      continue
    }
    if (!isRecord(ptyIds)) {
      return null
    }
    for (const [leafId, sessionId] of Object.entries(ptyIds)) {
      if (
        !isId(leafId) ||
        !isId(sessionId) ||
        (rootLeaves instanceof Set && !rootLeaves.has(leafId))
      ) {
        return null
      }
      bindings.push({ sessionId, workspaceKey: '', tabId, leafId })
    }
  }
  return bindings
}

function mergeTabAndLayoutBindings(
  tabs: TabRow[],
  layouts: RawTerminalBinding[]
): RawTerminalBinding[] | null {
  const tabById = new Map(tabs.map((tab) => [tab.tabId, tab]))
  const merged: RawTerminalBinding[] = []
  for (const layout of layouts) {
    const tab = tabById.get(layout.tabId)
    merged.push({ ...layout, workspaceKey: tab?.workspaceKey ?? `layout:${layout.tabId}` })
  }
  for (const tab of tabs) {
    if (!tab.sessionId) {
      continue
    }
    const tabLayouts = merged.filter((binding) => binding.tabId === tab.tabId)
    if (
      tabLayouts.length > 0 &&
      !tabLayouts.some((binding) => binding.sessionId === tab.sessionId)
    ) {
      return null
    }
    if (!tabLayouts.some((binding) => binding.sessionId === tab.sessionId)) {
      merged.push({
        sessionId: tab.sessionId,
        workspaceKey: tab.workspaceKey,
        tabId: tab.tabId,
        leafId: null
      })
    }
  }
  const ownerBySession = new Map<string, string>()
  const deduplicated: RawTerminalBinding[] = []
  for (const binding of merged) {
    const owner = `${binding.workspaceKey}\0${binding.tabId}\0${binding.leafId ?? ''}`
    const existing = ownerBySession.get(binding.sessionId)
    if (existing && existing !== owner) {
      return null
    }
    if (!existing) {
      ownerBySession.set(binding.sessionId, owner)
      deduplicated.push(binding)
    }
  }
  return deduplicated
}

function parseSleepingRoutes(
  value: unknown,
  bindings: RawTerminalBinding[]
): RawSleepingRoute[] | null {
  if (value === undefined) {
    return []
  }
  if (!isRecord(value)) {
    return null
  }
  const routes: RawSleepingRoute[] = []
  for (const [paneKey, rawRoute] of Object.entries(value)) {
    if (
      !isId(paneKey) ||
      !isRecord(rawRoute) ||
      hasUnknownNestedOwnershipField(rawRoute, 'sleep') ||
      rawRoute.paneKey !== paneKey
    ) {
      return null
    }
    if (!isId(rawRoute.worktreeId) || !isValidProviderSession(rawRoute.providerSession)) {
      return null
    }
    if (
      rawRoute.connectionId !== undefined &&
      rawRoute.connectionId !== null &&
      !isId(rawRoute.connectionId)
    ) {
      return null
    }
    const parsedPane = parsePaneKey(paneKey) ?? parseLegacyNumericPaneKey(paneKey)
    const parsedTabId = parsedPane?.tabId
    if (
      rawRoute.tabId !== undefined &&
      (!isId(rawRoute.tabId) || (parsedTabId && rawRoute.tabId !== parsedTabId))
    ) {
      return null
    }
    const tabId = typeof rawRoute.tabId === 'string' ? rawRoute.tabId : parsedTabId
    if (!tabId) {
      return null
    }
    const connectionId = typeof rawRoute.connectionId === 'string' ? rawRoute.connectionId : null
    const joinedSessionId = connectionId
      ? null
      : resolveSleepingBinding(bindings, rawRoute.worktreeId, tabId, parsedPane)
    routes.push({
      paneKey,
      tabId,
      workspaceKey: rawRoute.worktreeId,
      connectionId,
      joinedSessionId
    })
  }
  return routes
}

function resolveSleepingBinding(
  bindings: RawTerminalBinding[],
  workspaceKey: string,
  tabId: string,
  parsedPane: ReturnType<typeof parsePaneKey> | ReturnType<typeof parseLegacyNumericPaneKey>
): string | null {
  const stableLeaf = parsedPane && 'leafId' in parsedPane ? parsedPane.leafId : null
  const candidates = bindings.filter(
    (binding) =>
      binding.workspaceKey === workspaceKey &&
      binding.tabId === tabId &&
      (!stableLeaf || binding.leafId === stableLeaf)
  )
  const ids = new Set(candidates.map(({ sessionId }) => sessionId))
  return ids.size === 1 ? [...ids][0] : null
}

function collectLayoutLeaves(root: unknown): Set<string> | false {
  if (root === null) {
    return new Set()
  }
  const leaves = new Set<string>()
  const stack: unknown[] = [root]
  let visited = 0
  while (stack.length > 0) {
    const node = stack.pop()
    visited += 1
    if (!isRecord(node) || visited > MAX_LAYOUT_NODES) {
      return false
    }
    if (hasUnknownNestedOwnershipField(node, 'none')) {
      return false
    }
    if (node.type === 'leaf' && isId(node.leafId) && !leaves.has(node.leafId)) {
      leaves.add(node.leafId)
    } else if (node.type === 'split' && node.first !== undefined && node.second !== undefined) {
      stack.push(node.first, node.second)
    } else {
      return false
    }
  }
  return leaves
}

function validateRemoteMetadata(value: Record<string, unknown>): boolean {
  const connections = value.activeConnectionIdsAtShutdown
  const sessions = value.remoteSessionIdsByTabId
  return (
    (connections === undefined || (Array.isArray(connections) && connections.every(isId))) &&
    (sessions === undefined ||
      (isRecord(sessions) &&
        Object.entries(sessions).every(([tabId, sessionId]) => isId(tabId) && isId(sessionId))))
  )
}

function isValidProviderSession(value: unknown): boolean {
  return (
    isRecord(value) &&
    !hasUnknownNestedOwnershipField(value, 'none') &&
    (value.key === 'session_id' || value.key === 'conversation_id') &&
    isId(value.id)
  )
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH
}

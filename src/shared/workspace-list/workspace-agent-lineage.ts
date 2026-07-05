import type { WorkspaceAgentRow, WorkspaceAgentRowLineage } from './workspace-list-model'

const ROOT_LINEAGE: WorkspaceAgentRowLineage = {
  depth: 0,
  isFirstSibling: true,
  isLastSibling: true,
  childCount: 0
}

function buildPaneKeyByTerminalHandle(rows: readonly WorkspaceAgentRow[]): Map<string, string> {
  const paneKeyByTerminalHandle = new Map<string, string>()
  for (const row of rows) {
    if (row.entry.terminalHandle && !paneKeyByTerminalHandle.has(row.entry.terminalHandle)) {
      paneKeyByTerminalHandle.set(row.entry.terminalHandle, row.paneKey)
    }
  }
  return paneKeyByTerminalHandle
}

function resolveParentPaneKey(
  row: WorkspaceAgentRow,
  rowsByPaneKey: ReadonlyMap<string, WorkspaceAgentRow>,
  paneKeyByTerminalHandle: ReadonlyMap<string, string>
): string | undefined {
  const explicitParentPaneKey = row.entry.orchestration?.parentPaneKey
  if (
    explicitParentPaneKey &&
    explicitParentPaneKey !== row.paneKey &&
    rowsByPaneKey.has(explicitParentPaneKey)
  ) {
    return explicitParentPaneKey
  }

  const parentTerminalHandles = [
    row.entry.orchestration?.parentTerminalHandle,
    row.entry.orchestration?.coordinatorHandle
  ]
  for (const parentTerminalHandle of parentTerminalHandles) {
    const parentPaneKey = parentTerminalHandle
      ? paneKeyByTerminalHandle.get(parentTerminalHandle)
      : undefined
    if (parentPaneKey && parentPaneKey !== row.paneKey && rowsByPaneKey.has(parentPaneKey)) {
      return parentPaneKey
    }
  }

  return undefined
}

export function applyWorkspaceAgentRowLineage(rows: WorkspaceAgentRow[]): WorkspaceAgentRow[] {
  if (rows.length <= 1) {
    return rows.map((row) => ({ ...row, lineage: ROOT_LINEAGE }))
  }

  const rowsByPaneKey = new Map<string, WorkspaceAgentRow>()
  for (const row of rows) {
    if (!rowsByPaneKey.has(row.paneKey)) {
      rowsByPaneKey.set(row.paneKey, row)
    }
  }
  const paneKeyByTerminalHandle = buildPaneKeyByTerminalHandle(rows)
  const childrenByParentPaneKey = new Map<string, WorkspaceAgentRow[]>()
  const childPaneKeys = new Set<string>()

  for (const row of rows) {
    const parentPaneKey = resolveParentPaneKey(row, rowsByPaneKey, paneKeyByTerminalHandle)
    if (!parentPaneKey) {
      continue
    }
    childPaneKeys.add(row.paneKey)
    const siblings = childrenByParentPaneKey.get(parentPaneKey)
    if (siblings) {
      siblings.push(row)
    } else {
      childrenByParentPaneKey.set(parentPaneKey, [row])
    }
  }

  const rootRows = rows.filter((row) => !childPaneKeys.has(row.paneKey))
  if (rootRows.length === 0) {
    return rows.map((row) => ({ ...row, lineage: ROOT_LINEAGE }))
  }

  const ordered: WorkspaceAgentRow[] = []
  const emitted = new Set<string>()
  const emitRow = (row: WorkspaceAgentRow, lineage: WorkspaceAgentRowLineage): boolean => {
    if (emitted.has(row.paneKey)) {
      return false
    }
    emitted.add(row.paneKey)
    ordered.push({ ...row, lineage })
    return true
  }

  const emitSubtree = (
    row: WorkspaceAgentRow,
    lineage: WorkspaceAgentRowLineage,
    ancestorPaneKeys: ReadonlySet<string> = new Set()
  ): void => {
    if (ancestorPaneKeys.has(row.paneKey)) {
      emitRow(row, ROOT_LINEAGE)
      return
    }
    const children = childrenByParentPaneKey.get(row.paneKey) ?? []
    if (!emitRow(row, { ...lineage, childCount: children.length })) {
      return
    }
    const nextAncestors = new Set(ancestorPaneKeys)
    nextAncestors.add(row.paneKey)
    children.forEach((child, index) => {
      emitSubtree(
        child,
        {
          depth: 1,
          isFirstSibling: index === 0,
          isLastSibling: index === children.length - 1,
          childCount: 0
        },
        nextAncestors
      )
    })
  }

  for (const row of rootRows) {
    emitSubtree(row, ROOT_LINEAGE)
  }

  for (const row of rows) {
    emitRow(row, ROOT_LINEAGE)
  }

  return ordered
}

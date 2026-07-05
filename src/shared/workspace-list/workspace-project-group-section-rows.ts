import type { FolderWorkspace, ProjectGroup, ProjectOrderBy } from '../types'
import type { OrderedGroupEntry } from './project-section-order'
import { sortRepoEntriesWithinProjectGroup } from './project-section-order'
import type { WorkspaceFolderWorkspaceRow, WorkspaceSectionRow } from './workspace-list-model'
import { getProjectGroupHeaderKey } from './workspace-section-constants'
import { withRepoSectionDisplayLabels } from './workspace-section-row-primitives'

export function appendProjectGroupRows(args: {
  result: WorkspaceSectionRow[]
  orderedGroups: OrderedGroupEntry[]
  projectGroups: readonly ProjectGroup[]
  folderWorkspaces: readonly FolderWorkspace[]
  projectOrderBy: ProjectOrderBy
  repoOrder?: Map<string, number>
  collapsedGroups: Set<string>
  appendOrderedGroups: (groupsToAppend: OrderedGroupEntry[], projectGroupDepth?: number) => void
}): void {
  const groupByProjectGroupId = new Map<string | null, OrderedGroupEntry[]>()
  for (const entry of args.orderedGroups) {
    const repo = entry[1].repo
    const projectGroupId = repo?.projectGroupId ?? null
    const list = groupByProjectGroupId.get(projectGroupId) ?? []
    list.push(entry)
    groupByProjectGroupId.set(projectGroupId, list)
  }

  const projectGroupsById = new Map(args.projectGroups.map((group) => [group.id, group]))
  const folderWorkspacesByProjectGroupId = getFolderWorkspacesByProjectGroupId(
    args.folderWorkspaces,
    projectGroupsById
  )
  const childGroupsByParentId = getChildGroupsByParentId(args.projectGroups, projectGroupsById)

  const getProjectGroupSubtreeCount = (groupId: string): number => {
    const directCount = groupByProjectGroupId.get(groupId)?.length ?? 0
    const folderWorkspaceCount = folderWorkspacesByProjectGroupId.get(groupId)?.length ?? 0
    const children = childGroupsByParentId.get(groupId) ?? []
    return children.reduce(
      (count, child) => count + getProjectGroupSubtreeCount(child.id),
      directCount + folderWorkspaceCount
    )
  }

  const appendProjectGroup = (projectGroup: ProjectGroup, depth: number): void => {
    const repoEntries = sortRepoEntriesWithinProjectGroup({
      entries: groupByProjectGroupId.get(projectGroup.id) ?? [],
      projectOrderBy: args.projectOrderBy,
      repoOrder: args.repoOrder
    })
    const childGroups = childGroupsByParentId.get(projectGroup.id) ?? []
    const key = getProjectGroupHeaderKey(projectGroup.id)
    args.result.push({
      type: 'header',
      key,
      label: projectGroup.name,
      count: getProjectGroupSubtreeCount(projectGroup.id),
      visual: 'project-group',
      projectGroup,
      projectGroupDepth: depth
    })
    if (!args.collapsedGroups.has(key)) {
      for (const folderWorkspace of folderWorkspacesByProjectGroupId.get(projectGroup.id) ?? []) {
        args.result.push({
          type: 'folder-workspace',
          key: `folder-workspace:${folderWorkspace.id}`,
          folderWorkspace,
          projectGroup,
          depth: 0,
          groupDepth: depth + 1
        } satisfies WorkspaceFolderWorkspaceRow)
      }
      args.appendOrderedGroups(withRepoSectionDisplayLabels(repoEntries), depth + 1)
      for (const childGroup of childGroups) {
        appendProjectGroup(childGroup, depth + 1)
      }
    }
    groupByProjectGroupId.delete(projectGroup.id)
  }

  for (const projectGroup of childGroupsByParentId.get(null) ?? []) {
    appendProjectGroup(projectGroup, 0)
  }

  const remainingRepoEntries = [...(groupByProjectGroupId.get(null) ?? [])]
  for (const [projectGroupId, entries] of groupByProjectGroupId) {
    if (projectGroupId === null || projectGroupsById.has(projectGroupId)) {
      continue
    }
    remainingRepoEntries.push(...entries)
  }
  args.appendOrderedGroups(
    withRepoSectionDisplayLabels(
      sortRepoEntriesWithinProjectGroup({
        entries: remainingRepoEntries,
        projectOrderBy: args.projectOrderBy,
        repoOrder: args.repoOrder
      })
    ),
    0
  )
}

function getFolderWorkspacesByProjectGroupId(
  folderWorkspaces: readonly FolderWorkspace[],
  projectGroupsById: ReadonlyMap<string, ProjectGroup>
): Map<string, FolderWorkspace[]> {
  const result = new Map<string, FolderWorkspace[]>()
  for (const workspace of folderWorkspaces) {
    const group = projectGroupsById.get(workspace.projectGroupId)
    if (!group?.parentPath) {
      continue
    }
    const list = result.get(workspace.projectGroupId) ?? []
    list.push(workspace)
    result.set(workspace.projectGroupId, list)
  }
  for (const list of result.values()) {
    list.sort((left, right) => {
      const leftOrder = left.manualOrder ?? left.sortOrder
      const rightOrder = right.manualOrder ?? right.sortOrder
      return rightOrder - leftOrder || left.name.localeCompare(right.name)
    })
  }
  return result
}

function getChildGroupsByParentId(
  projectGroups: readonly ProjectGroup[],
  projectGroupsById: ReadonlyMap<string, ProjectGroup>
): Map<string | null, ProjectGroup[]> {
  const result = new Map<string | null, ProjectGroup[]>()
  for (const group of projectGroups) {
    const parentId =
      group.parentGroupId && projectGroupsById.has(group.parentGroupId) ? group.parentGroupId : null
    const children = result.get(parentId) ?? []
    children.push(group)
    result.set(parentId, children)
  }
  for (const groups of result.values()) {
    groups.sort(
      (left, right) => left.tabOrder - right.tabOrder || left.name.localeCompare(right.name)
    )
  }
  return result
}

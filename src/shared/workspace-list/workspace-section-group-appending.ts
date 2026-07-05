import type { Repo } from '../types'
import type { OrderedGroupEntry, WorkspaceGroupEntry } from './project-section-order'
import type { WorkspacePendingCreationRef, WorkspaceSectionRow } from './workspace-list-model'
import { appendWorktreeRows } from './workspace-lineage-section-rows'
import { buildProjectGroupingIndex } from './workspace-project-grouping'
import { getMixedHostContextLabels } from './workspace-section-host-context'
import type { NormalizedRowsArgs } from './workspace-section-row-args'
import {
  buildImportedWorktreesCardRow,
  buildNewExternalWorktreesInboxRow,
  buildPendingCreationRow,
  headerForGroup,
  orderMainWorktreeFirst
} from './workspace-section-row-primitives'

export function appendGroups(args: {
  source: NormalizedRowsArgs
  result: WorkspaceSectionRow[]
  groupsToAppend: OrderedGroupEntry[]
  projectGroupDepth: number
  pendingByRepo: Map<string, WorkspacePendingCreationRef[]>
}): void {
  const projectIndex = buildProjectGroupingIndex(args.source.projectGrouping)
  for (const [key, group] of args.groupsToAppend) {
    const repo = group.repo
    args.result.push(
      headerForGroup({
        groupBy: args.source.groupBy,
        key,
        group,
        repo,
        projectGroupDepth: args.projectGroupDepth,
        workspaceStatuses: args.source.workspaceStatuses
      })
    )
    if (args.source.collapsedGroups.has(key)) {
      continue
    }
    appendRepoGroupInlineRows(args.source, args.result, group, key, repo, args.pendingByRepo)
    const items = args.source.groupBy === 'repo' ? orderMainWorktreeFirst(group.items) : group.items
    appendWorktreeRows(
      args.result,
      items,
      args.source.repoMap,
      args.source.lineageById,
      args.source.worktreeMap,
      {
        nestLineage: args.source.nestLineage,
        collapsedGroups: args.source.collapsedGroups,
        groupDepth: args.projectGroupDepth,
        sectionKey: key,
        hostContextLabelByRepoId:
          args.source.groupBy === 'repo'
            ? getMixedHostContextLabels(
                group,
                args.source.repoMap,
                projectIndex,
                args.source.hostLabelById
              )
            : undefined
      }
    )
  }
}

function appendRepoGroupInlineRows(
  args: NormalizedRowsArgs,
  result: WorkspaceSectionRow[],
  group: WorkspaceGroupEntry,
  key: string,
  repo: Repo | undefined,
  pendingByRepo: Map<string, WorkspacePendingCreationRef[]>
): void {
  if (args.groupBy !== 'repo') {
    return
  }
  const repoIds =
    group.repoIds.size > 0
      ? [...group.repoIds]
      : repo
        ? [repo.id]
        : key.startsWith('repo:')
          ? [key.slice('repo:'.length)]
          : []
  for (const repoId of repoIds) {
    const candidate = args.importedWorktreesByRepo.get(repoId)
    if (candidate) {
      result.push(buildImportedWorktreesCardRow(candidate, 'repo-group'))
    }
  }
  for (const repoId of repoIds) {
    const candidate = args.newExternalWorktreesInboxByRepo.get(repoId)
    if (candidate) {
      result.push(buildNewExternalWorktreesInboxRow(candidate))
    }
  }
  for (const repoId of repoIds) {
    for (const creation of pendingByRepo.get(repoId) ?? []) {
      result.push(buildPendingCreationRow(creation, args.repoMap))
    }
  }
}

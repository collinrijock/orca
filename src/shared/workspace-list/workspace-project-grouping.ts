import { getExecutionHostLabel, getRepoExecutionHostId } from '../execution-host'
import { isWindowsAbsolutePathLike } from '../cross-platform-path'
import { parseWslUncPath } from '../wsl-paths'
import type { Project, ProjectHostSetup, Repo } from '../types'
import type { WorkspaceProjectGroupingModel } from './workspace-list-model'
import type { WorkspaceGroupEntry } from './project-section-order'

export type ProjectGroupingIndex = {
  projectById: Map<string, Project>
  setupByRepoId: Map<string, ProjectHostSetup>
  projectIdsRequiringSetupGroups: Set<string>
}

export type ProjectHeaderRevealTarget = {
  key: string
  label: string
  repo?: Repo
  projectId?: string
}

function isDistinctUserCheckout(setup: ProjectHostSetup): boolean {
  return setup.setupMethod !== 'provisioned'
}

function getProjectSetupSurfaceKey(setup: ProjectHostSetup): string {
  const wslPath = parseWslUncPath(setup.path)
  if (wslPath) {
    return `${setup.projectId}::${setup.hostId}::wsl:${wslPath.distro.toLowerCase()}`
  }
  if (isWindowsAbsolutePathLike(setup.path)) {
    return `${setup.projectId}::${setup.hostId}::windows-host`
  }
  return `${setup.projectId}::${setup.hostId}::default`
}

export function buildProjectGroupingIndex(
  model?: WorkspaceProjectGroupingModel
): ProjectGroupingIndex | null {
  if (!model || model.projects.length === 0 || model.projectHostSetups.length === 0) {
    return null
  }
  const checkoutsByProjectSurface = new Map<string, { projectId: string; count: number }>()
  for (const setup of model.projectHostSetups) {
    if (!isDistinctUserCheckout(setup)) {
      continue
    }
    const key = getProjectSetupSurfaceKey(setup)
    const existing = checkoutsByProjectSurface.get(key)
    if (existing) {
      existing.count += 1
    } else {
      checkoutsByProjectSurface.set(key, { projectId: setup.projectId, count: 1 })
    }
  }
  const projectIdsRequiringSetupGroups = new Set<string>()
  for (const { projectId, count } of checkoutsByProjectSurface.values()) {
    if (count > 1) {
      projectIdsRequiringSetupGroups.add(projectId)
    }
  }
  return {
    projectById: new Map(model.projects.map((project) => [project.id, project])),
    setupByRepoId: new Map(model.projectHostSetups.map((setup) => [setup.repoId, setup])),
    projectIdsRequiringSetupGroups
  }
}

export function getProjectGroupingForRepo(
  repoId: string,
  repoMap: Map<string, Repo>,
  projectIndex: ProjectGroupingIndex | null
): ProjectHeaderRevealTarget {
  const repo = repoMap.get(repoId)
  const setup = projectIndex?.setupByRepoId.get(repoId)
  const project = setup ? projectIndex?.projectById.get(setup.projectId) : undefined
  if (!setup || !project) {
    return {
      key: `repo:${repoId}`,
      label: repo?.displayName ?? 'Unknown',
      repo
    }
  }
  if (
    projectIndex?.projectIdsRequiringSetupGroups.has(setup.projectId) &&
    isDistinctUserCheckout(setup)
  ) {
    return {
      key: `project:${project.id}::setup:${repoId}`,
      label: repo?.displayName ?? setup.displayName,
      repo,
      projectId: project.id
    }
  }
  return {
    key: `project:${project.id}`,
    label: project.displayName,
    repo,
    projectId: project.id
  }
}

export function getProjectHeaderRevealTarget(
  repoId: string,
  repoMap: Map<string, Repo>,
  projectGrouping?: WorkspaceProjectGroupingModel
): ProjectHeaderRevealTarget {
  return getProjectGroupingForRepo(repoId, repoMap, buildProjectGroupingIndex(projectGrouping))
}

function getRepoHostLabel(
  repoId: string,
  repoMap: Map<string, Repo>,
  projectIndex: ProjectGroupingIndex | null,
  hostLabelById: ReadonlyMap<string, string> | undefined
): string | null {
  const setup = projectIndex?.setupByRepoId.get(repoId)
  if (setup) {
    return hostLabelById?.get(setup.hostId) ?? getExecutionHostLabel(setup.hostId)
  }
  const repo = repoMap.get(repoId)
  if (!repo) {
    return null
  }
  const hostId = getRepoExecutionHostId(repo)
  return hostLabelById?.get(hostId) ?? getExecutionHostLabel(hostId)
}

export function getMixedHostContextLabels(
  group: WorkspaceGroupEntry,
  repoMap: Map<string, Repo>,
  projectIndex: ProjectGroupingIndex | null,
  hostLabelById: ReadonlyMap<string, string> | undefined
): Map<string, string> | undefined {
  const labelsByRepoId = new Map<string, string>()
  const uniqueLabels = new Set<string>()
  for (const repoId of group.repoIds) {
    const label = getRepoHostLabel(repoId, repoMap, projectIndex, hostLabelById)
    if (!label) {
      continue
    }
    labelsByRepoId.set(repoId, label)
    uniqueLabels.add(label)
  }
  return uniqueLabels.size > 1 ? labelsByRepoId : undefined
}

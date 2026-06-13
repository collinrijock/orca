import { getRepoExecutionHostId, LOCAL_EXECUTION_HOST_ID } from '../../../shared/execution-host'
import type { Repo } from '../../../shared/types'

export function getDefaultTaskRepoSelection(repos: readonly Repo[]): Set<string> {
  const selectedByProject = new Map<string, Repo>()
  for (const repo of repos) {
    const projectKey = getTaskRepoProjectKey(repo)
    const current = selectedByProject.get(projectKey)
    if (!current || compareDefaultTaskRepoCandidate(repo, current) < 0) {
      selectedByProject.set(projectKey, repo)
    }
  }
  return new Set([...selectedByProject.values()].map((repo) => repo.id))
}

export function getTaskProjectPickerRepos(
  repos: readonly Repo[],
  preferredSelection: ReadonlySet<string> = new Set()
): Repo[] {
  const selectedByProject = new Map<string, Repo>()
  for (const repo of repos) {
    const projectKey = getTaskRepoProjectKey(repo)
    const current = selectedByProject.get(projectKey)
    if (!current || compareTaskProjectPickerCandidate(repo, current, preferredSelection) < 0) {
      selectedByProject.set(projectKey, repo)
    }
  }
  return [...selectedByProject.values()]
}

export function normalizeTaskRepoSelection(
  repos: readonly Repo[],
  selection: ReadonlySet<string>
): Set<string> {
  const selectedByProject = new Map<string, Repo>()
  const selectedIds = new Set(selection)
  for (const repo of repos) {
    if (!selectedIds.has(repo.id)) {
      continue
    }
    const projectKey = getTaskRepoProjectKey(repo)
    const current = selectedByProject.get(projectKey)
    if (!current || compareDefaultTaskRepoCandidate(repo, current) < 0) {
      selectedByProject.set(projectKey, repo)
    }
  }
  if (selectedByProject.size === 0) {
    return getDefaultTaskRepoSelection(repos)
  }
  return new Set([...selectedByProject.values()].map((repo) => repo.id))
}

export function getTaskRepoProjectKey(repo: Repo): string {
  const owner = typeof repo.upstream?.owner === 'string' ? repo.upstream.owner.trim() : ''
  const name = typeof repo.upstream?.repo === 'string' ? repo.upstream.repo.trim() : ''
  return owner && name ? `github:${owner.toLowerCase()}/${name.toLowerCase()}` : `repo:${repo.id}`
}

function compareTaskProjectPickerCandidate(
  a: Repo,
  b: Repo,
  preferredSelection: ReadonlySet<string>
): number {
  const aPreferred = preferredSelection.has(a.id)
  const bPreferred = preferredSelection.has(b.id)
  if (aPreferred !== bPreferred) {
    return aPreferred ? -1 : 1
  }
  return compareDefaultTaskRepoCandidate(a, b)
}

function compareDefaultTaskRepoCandidate(a: Repo, b: Repo): number {
  // Why: when the same logical project exists on multiple hosts, default to
  // the local checkout to avoid surprising remote auth/network work on first load.
  const aLocal = getRepoExecutionHostId(a) === LOCAL_EXECUTION_HOST_ID
  const bLocal = getRepoExecutionHostId(b) === LOCAL_EXECUTION_HOST_ID
  if (aLocal !== bLocal) {
    return aLocal ? -1 : 1
  }
  return (a.addedAt ?? 0) - (b.addedAt ?? 0) || a.id.localeCompare(b.id)
}

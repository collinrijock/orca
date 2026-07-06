import { getGitHubApiHostForRepo, ghRepoExecOptions, githubRepoContext } from '../gh-utils'
import type { GitHubRepoTarget } from '../../../shared/github-project-types'

export type GhApiRoute = { cwd?: string; hostname?: string }

// Why (issue #1715): `gh api graphql` does not reliably infer the API host
// from cwd for hostless GraphQL calls, so resolve the repo's git remote host
// and pass it as `gh api --hostname`. Keep cwd for placeholder expansion and
// for commands that still consult local repo context.
export async function targetToGhApiRoute(
  target: GitHubRepoTarget | undefined
): Promise<GhApiRoute> {
  if (!target?.repoPath) {
    return {}
  }
  const cwd = ghRepoExecOptions(githubRepoContext(target.repoPath, target.connectionId)).cwd
  const hostname = await getGitHubApiHostForRepo(target.repoPath, target.connectionId)
  return {
    ...(cwd ? { cwd } : {}),
    ...(hostname ? { hostname } : {})
  }
}

export function normalizeGhApiRoute(route?: GhApiRoute | string): GhApiRoute {
  if (!route) {
    return {}
  }
  return typeof route === 'string' ? { cwd: route } : route
}

export function ghApiArgs(route: GhApiRoute, endpoint: string): string[] {
  return ['api', ...(route.hostname ? ['--hostname', route.hostname] : []), endpoint]
}

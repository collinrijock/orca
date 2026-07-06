import {
  normalizeGitHubApiHost,
  parseGitHubRemoteIdentity,
  preferredGitHubApiHost
} from './github-remote-identity-parsing'
import { getRemoteUrlForRepo, githubRepoContext } from './github-repository-identity'

// Why (issue #1715): mirror the owner/repo positive-cache window so a repo's
// resolved gh API host and its owner/repo lookups expire on the same cadence.
const REPO_HOST_CACHE_TTL_MS = 30_000

const repoHostCache = new Map<string, { value: string | null; expiresAt: number }>()
// Why: on cold project open several callers (view table, view list, mutations,
// auth diagnose) resolve the host concurrently before the cache is warm. An
// in-flight map collapses that burst into a single git-remote lookup instead
// of one `git remote get-url` fan-out per caller, mirroring ownerRepoInFlight.
const repoHostInFlight = new Map<string, Promise<string | null>>()

/** @internal - exposed for tests only */
export function _resetRepoHostCache(): void {
  repoHostCache.clear()
  repoHostInFlight.clear()
}

// Why (issue #1715): in multi-host setups gh must target the repo's own host.
// Prefer the upstream remote's host, then origin's, so forks of a GHE repo
// route to the enterprise host rather than the user's default github.com.
export async function getGitHubApiHostForRepo(
  repoPath: string,
  connectionId?: string | null
): Promise<string | null> {
  const context = githubRepoContext(repoPath, connectionId)
  const cacheKey = `${context.connectionId ?? 'local'}\0${context.repoPath}\0api-host`
  const cached = repoHostCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value
  }
  if (cached) {
    repoHostCache.delete(cacheKey)
  }

  const inFlight = repoHostInFlight.get(cacheKey)
  if (inFlight) {
    return inFlight
  }

  const promise = (async () => {
    let fallback: string | null = null
    for (const remoteName of ['upstream', 'origin']) {
      try {
        const remoteUrl = await getRemoteUrlForRepo(context, remoteName)
        const identity = remoteUrl ? parseGitHubRemoteIdentity(remoteUrl) : null
        const host = identity ? normalizeGitHubApiHost(identity.host) : null
        if (!host) {
          continue
        }
        if (preferredGitHubApiHost(host)) {
          return host
        }
        fallback ??= host
      } catch {
        // ignore missing remotes or non-git paths
      }
    }
    return fallback
  })()
    .then((value) => {
      repoHostCache.set(cacheKey, { value, expiresAt: Date.now() + REPO_HOST_CACHE_TTL_MS })
      return value
    })
    .finally(() => {
      repoHostInFlight.delete(cacheKey)
    })

  repoHostInFlight.set(cacheKey, promise)
  return promise
}

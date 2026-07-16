import { spawn } from 'node:child_process'
import { normalizeHookTrustKeyForLookup } from './config-toml-trust'
import { runCodexAppServerSession, type CodexAppServerInvocation } from './codex-app-server-session'

export {
  CodexAppServerTimeoutError,
  CodexAppServerUnsupportedError,
  isCodexAppServerUnsupportedError
} from './codex-app-server-session'
export type { CodexAppServerInvocation } from './codex-app-server-session'

// Why: Codex gates hooks on a `trusted_hash` it computes from a private
// canonical-JSON identity. Orca used to replicate that algorithm
// (computeTrustedHash), which drifted from the real one across Codex releases
// (#7896, #7110, #8699). `codex app-server` exposes the same sanctioned RPCs
// the Codex TUI "Trust all" button uses — hooks/list (returns Codex's own
// currentHash per hook) and config/batchWrite (upserts hooks.state through
// Codex's comment-preserving writer) — so this client grants trust with
// Codex as the only hash authority. See upstream codex-rs/tui/src/hooks_rpc.rs
// and codex-rs/tui/src/startup_hooks_review.rs.

export type CodexHookTrustGrantRequest = {
  invocation: CodexAppServerInvocation
  /** cwd passed to hooks/list. Discovery of the managed CODEX_HOME's
   *  hooks.json is cwd-independent (user scope); this only scopes which
   *  project hooks appear, which the key filter below ignores anyway. */
  hooksListCwd: string
  /** Lookup-normalized trust keys (normalizeHookTrustKeyForLookup shape) for
   *  the managed entries Orca just wrote. Grants are restricted to hooks whose
   *  reported key normalizes into this set — user hooks are never touched. */
  expectedTrustKeys: string[]
  /** Exact command string written to the managed hooks.json entries. */
  managedCommand: string
}

export type CodexGrantedHookTrust = {
  /** Trust key exactly as Codex reported it. */
  key: string
  normalizedKey: string
  /** Codex-computed hash now stored as trusted_hash for this key. */
  trustedHash: string
}

export type CodexHookTrustGrantSessionResult =
  | {
      outcome: 'granted'
      entries: CodexGrantedHookTrust[]
      /** False when every expected entry was already trusted (no write). */
      wroteTrust: boolean
    }
  | { outcome: 'verify-failed'; reason: string }

export type CodexHookListing = {
  key: string
  command: string | null
  currentHash: string
  trustStatus: string
  enabled: boolean
}

export function collectCodexHookListings(result: unknown): CodexHookListing[] {
  const data =
    result && typeof result === 'object' && Array.isArray((result as { data?: unknown }).data)
      ? ((result as { data: unknown[] }).data as { hooks?: unknown }[])
      : []
  const listings: CodexHookListing[] = []
  const seenKeys = new Set<string>()
  for (const entry of data) {
    const hooks = Array.isArray(entry?.hooks) ? entry.hooks : []
    for (const hook of hooks as Record<string, unknown>[]) {
      if (
        typeof hook?.key !== 'string' ||
        typeof hook.currentHash !== 'string' ||
        typeof hook.trustStatus !== 'string'
      ) {
        continue
      }
      // Why: hooks/list repeats user-scope hooks per requested cwd; grants
      // must consider each key once.
      if (seenKeys.has(hook.key)) {
        continue
      }
      seenKeys.add(hook.key)
      listings.push({
        key: hook.key,
        command: typeof hook.command === 'string' ? hook.command : null,
        currentHash: hook.currentHash,
        trustStatus: hook.trustStatus,
        enabled: typeof hook.enabled === 'boolean' ? hook.enabled : true
      })
    }
  }
  return listings
}

/**
 * Runs one short-lived `codex app-server` session over stdio JSON-RPC (JSONL)
 * and grants trust for exactly the expected managed entries:
 * initialize → initialized → hooks/list → config/batchWrite → hooks/list.
 * The child is reaped on every path; the session deadline SIGKILLs it.
 */
export async function runCodexHookTrustGrantSession(
  request: CodexHookTrustGrantRequest,
  spawnImpl: typeof spawn = spawn
): Promise<CodexHookTrustGrantSessionResult> {
  return runCodexAppServerSession(
    request.invocation,
    async (requestRpc) => {
      const expectedKeys = new Set(request.expectedTrustKeys)
      const matchManaged = (listing: CodexHookListing): boolean =>
        listing.command === request.managedCommand &&
        expectedKeys.has(normalizeHookTrustKeyForLookup(listing.key))

      const listResult = await requestRpc('hooks/list', { cwds: [request.hooksListCwd] })
      const managedListings = collectCodexHookListings(listResult).filter(matchManaged)
      if (managedListings.length !== expectedKeys.size) {
        return {
          outcome: 'verify-failed',
          reason: `hooks/list reported ${managedListings.length} of ${expectedKeys.size} expected managed entries`
        }
      }

      const needingTrust = managedListings.filter((listing) => listing.trustStatus !== 'trusted')
      if (needingTrust.length > 0) {
        // Why: same wire shape as the Codex TUI "Trust all" flow — one upsert
        // edit under hooks.state with each key's Codex-computed current hash.
        const value: Record<string, { trusted_hash: string }> = {}
        for (const listing of needingTrust) {
          value[listing.key] = { trusted_hash: listing.currentHash }
        }
        await requestRpc('config/batchWrite', {
          edits: [{ keyPath: 'hooks.state', value, mergeStrategy: 'upsert' }],
          reloadUserConfig: true
        })
      }

      const verifyResult = await requestRpc('hooks/list', { cwds: [request.hooksListCwd] })
      const verifiedListings = collectCodexHookListings(verifyResult).filter(matchManaged)
      const untrusted = verifiedListings.filter((listing) => listing.trustStatus !== 'trusted')
      if (verifiedListings.length !== expectedKeys.size || untrusted.length > 0) {
        return {
          outcome: 'verify-failed',
          reason:
            untrusted.length > 0
              ? `post-grant verify left ${untrusted.length} entries ${untrusted[0].trustStatus}`
              : `post-grant verify reported ${verifiedListings.length} of ${expectedKeys.size} entries`
        }
      }
      return {
        outcome: 'granted',
        wroteTrust: needingTrust.length > 0,
        entries: verifiedListings.map((listing) => ({
          key: listing.key,
          normalizedKey: normalizeHookTrustKeyForLookup(listing.key),
          trustedHash: listing.currentHash
        }))
      }
    },
    spawnImpl
  )
}

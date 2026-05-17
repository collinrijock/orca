# Remove Repos From GitHub Views

## Problem

When a repo is removed from Orca, GitHub Tasks/Projects can still surface that repo’s data.

Current behavior is mixed:
- Tasks repo selection is pruned when `repos` changes, so new fetches target only live repos.
- `removeRepo` does **not** evict GitHub caches (`workItemsCache`, `prCache`, `issueCache`, `checksCache`, `commentsCache`) and does not clear in-flight work-item requests.
- Project table rendering is cache-driven and currently unfiltered by “repos opened in Orca”, so removed-repo rows remain visible until a refetch happens to exclude them.
- Project row actions already gate on slug→repo matching; unmatched rows fall back to slug-mode/open-in-GitHub behavior. Visibility is the gap, not action routing.

## Code Reality (must be reflected in design)

- `workItemsCacheKey(repoId, limit, query)` is repo-id keyed.
- `selectTaskPageWorkItemsCacheEntries` still calls `workItemsCacheKey(repo.path, ...)` (wrong key).
- `findTaskPageDialogWorkItem` scans whole `workItemsCache`, but requires both `id` and `repoId` match.
- `repoScopedCacheKey` for PR/issue/check/comment caches is `${repoId ?? repoPath}::${suffix}`; legacy path-keyed entries can exist.
- `ProjectViewWrapper` currently passes unfiltered `table` to `ProjectViewList`.
- `useRepoSlugIndex` currently returns only a lookup function (no "ready/rebuilding" state), so callers cannot distinguish "index still rebuilding" from "no rows match".
- `useRepoSlugIndex` already evicts cache entries for repos no longer in `state.repos`, but repo removal does not explicitly clear by repo id at removal time.

## Root Cause

Two independent correctness gaps:
1. No repo-removal cache invalidation in GitHub slice.
2. No project-row visibility filter against currently opened Orca repos.

## Non-Goals

- No GitHub-side deletion/mutation of issues, PRs, or project items.
- No server-side “opened in Orca” project filter.
- No Linear/GitLab behavior changes.
- No auto-clone flow from project rows.

## Required Changes

1. Add GitHub-slice repo-eviction API
- Add `evictGitHubRepoCaches(repoId: string, repoPath?: string)` in `github.ts`.
- Evict all matching keys from:
  - `workItemsCache` (repo-id prefix and legacy path prefix)
  - `prCache`, `issueCache`, `checksCache`, `commentsCache` (id/path scoped)
- Drop matching `inflightWorkItemsRequests` keys.
- Bump `workItemsInvalidationNonce` when any `workItemsCache` entries were evicted.

2. Call eviction from repo removal
- In `repos.ts removeRepo`, after backend remove succeeds and before final state prune, read repo path from current state and call:
  - `evictGitHubRepoCaches(repoId, repoPath)`
  - `clearRepoSlugCacheEntry(repoId)`
- Keep this call in renderer state path (same window that executes removal).

3. Fix Tasks selector keying
- `selectTaskPageWorkItemsCacheEntries` must use `repo.id` for `workItemsCacheKey`.
- `repoPath` stays in `TaskPageRepoSourceState` only for UI identity/retry labels.

4. Filter project rows client-side
- In `ProjectViewWrapper`, derive `visibleRows` from `table.rows` where `row.content.repository` resolves via slug index to at least one live Orca repo.
- Exclude missing/invalid/unresolvable repository rows once slug index is resolved for current repo set.
- Extend `useRepoSlugIndex` (or add a companion hook) to expose readiness for the current repo snapshot (e.g., `{ lookupSlug, ready }` or generation token).
- While slug index is rebuilding for a new repo snapshot, keep last rendered filtered table to avoid flash-to-empty; apply strict filtering once ready.
- Pass filtered table to `ProjectViewList`.
- Keep row action guards; do not rely on filtering alone.

5. Close stale dialogs/modals on repo/slug changes
- If `dialogRepoItem.repoId` is no longer in live repos, close dialog.
- If a slug currently in `slugDialog`/`repoNotInOrca` now resolves to a live repo, close stale unknown-repo state.

## Consistency and Concurrency

- In-flight race: removal must clear in-flight work-item dedupe keys before nonce-driven re-fetch paths can reuse stale in-flight entries.
- `projectViewCache` is keyed by project/view/query, not repo; repo removal cannot key-evict rows surgically. Row filtering is the correctness boundary.
- Multi-window: cache invalidation is renderer-local unless each window executes equivalent invalidation on repo change events. Document as eventual consistency unless cross-window invalidation is explicitly wired.
- External mutation (remote URL/repo transfer): slug cache can stale. Repo-removal invalidation is required; remote-change invalidation is separate follow-up.

## Feasibility Constraints

- There is no single GitHub API call that applies “repo is currently opened in Orca” filtering to a Project view.
- Project query overrides are not a substitute for this requirement; they are user-entered search strings and do not provide safe/complete set filtering for dynamic Orca repo membership.
- Slug resolution has real cost (IPC + git remote resolution, possibly runtime RPC). Keep async generation guards and avoid blocking render on a full rebuild.

## Edge Cases

- Removing the last repo: Tasks selection collapses to empty/all-eligible behavior; Project table should render zero visible rows after slug resolution settles.
- Multiple Orca repos mapping to same slug: row remains visible while any matching repo exists.
- Non-GitHub repos or unresolved slugs: filtered out from Project visibility.
- Repo removed while dialog is open: dialog must close.
- Legacy path-keyed cache entries: evict alongside repo-id keys.

## Rollout Order

1. Add `evictGitHubRepoCaches` with tests (id/path key eviction, inflight clearing, nonce bump conditions).
2. Wire `removeRepo` to eviction + `clearRepoSlugCacheEntry`; add repo-removal tests.
3. Fix `task-page-cache-selectors` keying + tests.
4. Add `ProjectViewWrapper` filtered-table and stale-dialog cleanup + tests.
5. Run typecheck, lint, targeted renderer/store tests.

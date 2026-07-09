# Stale OPEN PR After Merge (Checks Panel Refresh)

## Problem

After a GitHub PR is merged, the Checks panel can keep showing **OPEN** and the **Squash and merge** CTA even when GitHub already reports the PR as merged.

Confirmed repro context:

- PR #7665 (`arabic-terminal-grid-shaping`) and #7852 (`improve-claude-code-agent-status`) were **merged** on GitHub.
- Checks still showed OPEN + Squash and merge after merge.
- Manual refresh (↻) did **not** clear the stale OPEN state.
- Local HEADs had already moved past the merged PR heads (for example, arabic: local `455cc5a` vs PR head `d25e81e`).

This is not a “force refresh forgot to hit the network” bug. Force refresh already re-fetches; the sticky OPEN state is a **preserve-on-write** behavior in the renderer PR cache after main returns an authoritative `no-pr`.

## Goal

When the branch no longer has a current open/draft PR and main authoritatively returns `no-pr` for a fallback-number refresh:

1. Checks must stop showing sticky OPEN (and merge CTA).
2. Manual ↻ must clear the stale open/draft cache entry, not preserve it.
3. Keep intentional merged-at-head visibility via `preservesMergedPRForCurrentHead` (and related card filters).
4. Keep `upstream-error` behavior: last-good cache remains on transient failures.

Expected primary UX after diverge + merge: ↻ clears OPEN → empty / create-PR surface, not sticky open.

## Non-goals

- Do **not** recommend “poll PR lifecycle more often” or “force ignores TTL harder” as the root fix. Force already fetches; stickiness is preserve-on-write.
- No broad PR-cache architecture rewrite.
- No GitLab MR redesign unless the same preserve-on-fallback-miss pattern is proven for GitLab.
- No change to checks-run polling cadence for this bug.
- No durable worktree-meta redesign for `linkedPR` in this pass (meta is often already null in the repro).
- No product requirement to always show historical MERGED after continued commits (optional second step only).

## Root Cause Diagnosis

Confidence: high (~85%) from code paths, unit tests, and the confirmed git state above.

### 1. Checks polling is not the PR lifecycle poller

ChecksPanel polls **check runs** for the current PR number. It does not continuously re-resolve PR open/merged lifecycle. Cache TTL alone is not why force refresh fails.

Relevant call sites:

- `src/renderer/src/components/right-sidebar/ChecksPanel.tsx` — force paths call `fetchPRForBranch(..., { force: true, ... })`.
- Checks poll effect around `fetchChecks` continues to use the cached PR number while that cache remains sticky-open.

### 2. Force refresh always re-supplies the stale open number as fallback

In ChecksPanel:

```ts
const fallbackGitHubPRNumber = linkedPR == null ? (pr?.number ?? null) : null
```

On manual refresh / post-mutation refresh / conflict refresh, Checks passes:

| arg | typical post-merge continued-work value |
| --- | --- |
| `linkedPRNumber` | from worktree meta, often `null` |
| `fallbackPRNumber` | `fallbackGitHubPRNumber` / `pr.number` — the **cached open** number |

So force refresh is not a bare branch lookup; it intentionally re-probes the already-visible PR number.

### 3. Main intentionally hides merged-implicit PRs when HEAD diverged

In `src/main/github/client.ts`:

- Branch lookup uses `state=all` and can find the merged PR.
- `shouldHideMergedImplicitPR` / `hideMergedImplicitPR` hide merged PRs when:
  - there is no durable `linkedPRNumber`, and
  - current HEAD OID ≠ PR `headRefOid`, and
  - HEAD is not confirmed contained in the merged PR.
- That hide is **intentional**: after merge + continued commits on the same branch, Orca should treat the branch as ready for a new PR rather than forever pinning the historical merged PR.
- Even with `acceptMergedFallbackPR` (set by `src/main/github/pr-refresh-coordinator.ts` when fallback source is present, and by renderer when `fallbackPRSource !== null`), **head-diverged** merged implicit PRs still resolve to `no-pr` via `explicitHeadHidesMergedImplicitPR` / the final hide path.

Result for the repro: authoritative outcome is `{ kind: 'no-pr' }`, not “found open” and not “found merged while diverged.”

### 4. Renderer preserve path rewrites that authoritative miss back into sticky OPEN

In `src/renderer/src/store/slices/github.ts`:

- `fetchPRForBranch` maps `no-pr` → `pr = null`, then writes caches through `setGitHubPRResultCaches` / `applyPRCacheResult`.
- `shouldPreserveExistingPRForFallbackMiss` returns true when:
  - `nextPR === null`
  - no `linkedPRNumber`
  - `fallbackPRNumber` matches the currently cached PR number
  - `fallbackPRSource !== 'hosted-review'`
- That preserve branch does **not** check PR state. It preserves **any** state, including `open` / `draft`.
- `applyPRCacheResult(..., preserveExisting: true)` leaves `prCache` untouched.
- `fetchPRForBranch` then returns the old cached PR object to Checks.
- **Mirrored sibling bug (confirmed, not hypothetical)**: `syncHostedReviewCacheFromGitHubPRResult` (same file) has its own preserve-on-fallback-miss branch with the identical predicate (no `linkedPRNumber`, matching `fallbackPRNumber`, source ≠ `hosted-review`) and the same missing state check. The preserved open `hostedReviewCache` row is what worktree cards render, and `githubHostedReviewFallbackPRNumber` re-derives the stale fallback number from it — so the open row self-perpetuates.
- Coupling: `shouldWritePRCacheForHostedReviewSync` only accepts the `prCache` null write when the hosted sync accepted. If only the `prCache` preserve is fixed, the entry is **deleted** (accepted=false) instead of written `{ data: null, fetchedAt }`, the hosted row stays open, and `hasAmbiguousGitHubHostedReviewForChecksPanel` (null `prCache` entry + GitHub hosted row) flips the Checks empty state to ambiguous copy instead of the create-PR surface.
- The same preserve pair also runs on the coordinator background path: `applyGitHubPRRefreshEvent` → `applyGitHubPRResultToCaches` → `applyPRCacheResult`.

Unit tests encoding the bug-as-feature:

- `src/renderer/src/store/slices/github.test.ts` — `"preserves visible cached PR data when a fallback refresh misses"`
  - seeds an **open** cached PR
  - force-refreshes with matching `fallbackPRNumber`
  - main returns `no-pr`
  - expects the open cache to remain — **and** asserts the open hosted-review row is preserved too
- Same file — `"preserves visible cached PR data when a fallback refresh event misses"` encodes the identical preserve for the coordinator event path (`applyGitHubPRRefreshEvent`).

### 5. Flakes already take a different path

`upstream-error` returns early with `cached?.data ?? null` and does **not** go through the preserve-on-no-pr write path. Sticky OPEN is specifically preserve-on-authoritative-`no-pr` for open/draft, not “keep last good on network error.”

## Intentional vs Bug

| Behavior | Classification | Why |
| --- | --- | --- |
| Hide merged branch PR when HEAD diverged and no durable linked PR | **Intentional** (`shouldHideMergedImplicitPR` / `hideMergedImplicitPR`) | Continued work on the branch should be free to open a new PR; historical merged PR is not current review state. |
| Preserve merged cache when HEAD still matches (or is confirmed-contained) | **Intentional** (`preservesMergedPRForCurrentHead`) | Keep merged visibility at the exact merge commit / contained head. Cards also gate via `isCachedMergedBranchPRCurrentForWorktree`. |
| Keep last-good cache on `upstream-error` | **Intentional** | Transient gh/network failures must not blank review state. |
| Preserve **open/draft** cache when fallback refresh returns authoritative `no-pr` | **Bug** | Treats a definitive “no current PR for this branch/fallback” as weaker than a stale open cache entry, so Checks never leaves OPEN + merge CTA. The defect exists twice: `prCache` preserve and the mirrored `hostedReviewCache` preserve in `syncHostedReviewCacheFromGitHubPRResult`. |

## Design

### Primary fix (product-aligned, required)

**Stop preserving non-terminal (`open` / `draft`) PR cache entries on authoritative `no-pr` via fallback number — in both caches.**

Change center of gravity (both in `src/renderer/src/store/slices/github.ts`):

- `shouldPreserveExistingPRForFallbackMiss` (prCache preserve)
- `syncHostedReviewCacheFromGitHubPRResult` (mirrored hosted-review preserve — same non-terminal state gate; required, see below)

Recommended shape:

1. Keep `preservesMergedPRForCurrentHead` unchanged (head equality or `confirmedContainedHeadOid` match).
2. Narrow or remove the open-ended `preservesFallbackPR` branch:
   - Do **not** preserve when `currentPR.state` is `open` or `draft` (and similarly any non-terminal state used by the product).
   - Optionally still preserve closed/merged only under the existing head-match path (prefer relying on `preservesMergedPRForCurrentHead` rather than a second vague fallback rule).
3. Ensure all write sites honor the same predicate:
   - `setGitHubPRResultCaches` → `applyPRCacheResult` (fetch path)
   - `applyGitHubPRResultToCaches` → `applyPRCacheResult` (coordinator event path via `applyGitHubPRRefreshEvent`)
   - the post-write return path in `fetchPRForBranch` that re-checks `shouldPreserveExistingPRForFallbackMiss` and returns cached data
4. Gate the mirrored hosted-review preserve with the same non-terminal predicate. This is **required**, not optional:
   - `shouldWritePRCacheForHostedReviewSync` only accepts the `prCache` null write when the hosted sync accepted; without the hosted-sync gate, the `prCache` entry is deleted instead of written `{ data: null, fetchedAt }` (OPEN still clears in Checks, but no negative cache and the doc’d null write never happens).
   - a preserved open hosted row keeps the worktree card stale, keeps `githubHostedReviewFallbackPRNumber` re-supplying the stale fallback number, and makes `hasAmbiguousGitHubHostedReviewForChecksPanel` degrade the Checks empty state to ambiguous copy instead of the create-PR surface.
   - once gated, GitHub rows fall through to `shouldClearHostedReviewForNoGitHubPR` (true for GitHub rows) and the accepted null write clears both caches.
   - manual ↻ later calls `refreshHostedReviewCard`, which can overwrite the hosted row, but the coordinator event path has no second write — fix the sync, don’t rely on the follow-up fetch.
5. Leave ChecksPanel `fallbackPRNumber` wiring alone for this fix. Passing the previously visible number is still useful for exact lifecycle probes; the bug is accepting open state after those probes authoritatively miss.

Files expected to change for primary fix:

- `src/renderer/src/store/slices/github.ts` — `shouldPreserveExistingPRForFallbackMiss` and the fallback-miss preserve branch in `syncHostedReviewCacheFromGitHubPRResult` (+ a shared named predicate for the state gate)
- `src/renderer/src/store/slices/github.test.ts` — reverse/replace open preserve tests (fetch path **and** event path); add clear-on-no-pr coverage for both caches

Files that explain the flow but likely do **not** need primary-fix code:

- `src/renderer/src/components/right-sidebar/ChecksPanel.tsx` — already force-fetches with fallback number
- `src/main/github/client.ts` — hide-merged-on-diverge is intentional
- `src/main/github/pr-refresh-coordinator.ts` — `acceptMergedFallbackPR` remains correct for head-matched / deleted-head merged fallbacks

### Optional second step (product choice, not required for sticky OPEN)

If product wants Checks to show **MERGED** after continue-on-branch (history visible) instead of empty / create PR:

1. Main `getPRForBranchOutcome` could return `found` with merged PR plus an explicit head-divergence signal (today linked paths already set `headDivergedFromMergedPRAtOid` in some cases; branch/fallback diverge currently collapses to bare `no-pr`).
2. Renderer would accept that merged payload into cache.
3. UI must still filter “current for this worktree” using existing helpers such as `isCachedMergedBranchPRCurrentForWorktree` in `src/renderer/src/components/sidebar/worktree-card-pr-display.ts`, so worktree cards do not permanently advertise a historical merged PR as active review after diverge.
4. Only pursue this if product wants post-continue MERGED history in Checks; it is **not** required to fix sticky OPEN.

Do not implement optional step unless product confirms; primary fix already restores correct non-sticky UX.

### Explicit non-solutions

- Increasing checks poll frequency.
- Treating force as “ignore main TTL only” without changing preserve-on-write.
- Always setting `acceptMergedFallbackPR` without head checks (would fight intentional hide-merged-on-diverge).
- Clearing all PR cache on every refresh (too broad; breaks upstream-error and merged-at-head UX).

## Data Flow

### Today (bug)

1. Checks shows cached `pr.state === 'open'`.
2. PR merges on GitHub; user continues commits; local HEAD ≠ PR head OID.
3. User hits ↻ (or another force path in ChecksPanel).
4. Checks calls `fetchPRForBranch` with `force: true`, `linkedPRNumber` often null, `fallbackPRNumber = cached open number`.
5. Main `getPRForBranchOutcome`:
   - branch lookup finds merged PR (`state=all`)
   - `hideMergedImplicitPR` true because HEAD diverged / not contained
   - fallback number lookup also finds the merged PR
   - still hidden → `{ kind: 'no-pr' }`
6. Renderer maps to `pr = null`.
7. `shouldPreserveExistingPRForFallbackMiss` true because fallback number matches open cache.
8. `applyPRCacheResult` keeps old open entry; `fetchPRForBranch` returns old open PR.
9. Checks re-renders OPEN + Squash and merge forever.

### After primary fix

1–6 same as above through authoritative `no-pr`.
7. Both preserve predicates false for open/draft.
8. Hosted-review row clears; the accepted sync lets `prCache` write `{ data: null, fetchedAt }`.
9. Checks shows empty / create PR (no merge CTA); worktree card stops advertising the merged PR as open.

### Preserved intentional paths after fix

- Forced refresh while still on the merge commit / contained head: merged cache remains via `preservesMergedPRForCurrentHead`.
- Forced refresh during network/`upstream-error`: last good remains.
- Durable `linkedPRNumber` exact lookups: still source of truth; not gated by the fallback-miss preserve rule.

## Edge Cases

- **Open PR truly closed/merged and branch deleted / branch lookup empty**: fallback exact lookup may still find the PR; if main then returns merged with head match, show merged; if main returns `no-pr` after hide, clear open.
- **Open PR still open**: main returns `found` open; preserve path is irrelevant; cache updates normally.
- **Draft PR**: treat like open (non-terminal); do not preserve on authoritative `no-pr`.
- **Merged, HEAD still at PR head**: keep merged via `preservesMergedPRForCurrentHead` even if main returns `no-pr` for branch-only lookup races.
- **Merged, HEAD is confirmed-contained behind final PR head**: keep merged (existing confirmed-contained path).
- **Merged, HEAD diverged with new commits**: primary fix → clear open; optional step → show merged history only if product chooses.
- **Hosted-review fallback source**: existing code already refuses preserve when `fallbackPRSource === 'hosted-review'`; keep that exception.
- **Linked PR meta set**: preserve-on-fallback-miss does not apply when `linkedPRNumber` is set; linked exact lookup / diverge-clear paths remain separate.
- **SSH / runtime / web preload**: same renderer preserve predicate; main lookup options (`acceptMergedFallbackPR`, `currentHeadOid`) already flow through IPC/runtime. No provider-specific sticky-open special case required for primary fix.
- **Concurrent force refreshes**: generation / inflight guards stay as-is; only the write acceptance changes.
- **Conflict-summary force path** (`fallbackPRNumber: fallbackGitHubPRNumber ?? pr.number`): same preserve fix applies; do not special-case conflict refresh.
- **GitLab / other forges**: out of scope unless the same fallback-miss preserve pattern is demonstrated.

## Test Plan

### Renderer unit (`src/renderer/src/store/slices/github.test.ts`)

1. **Reverse/replace** `"preserves visible cached PR data when a fallback refresh misses"`:
   - seed open cached PR #12 (the existing test also seeds and asserts the open hosted-review row — reverse both assertions)
   - force refresh with `fallbackPRNumber: 12`
   - main returns `no-pr`
   - expect `prCache` to hold an accepted null (not preserved open) and the hosted-review row to clear
   - expect function return value to be null (not the old open PR)
2. **Reverse/replace** the event-path twin `"preserves visible cached PR data when a fallback refresh event misses"` (`applyGitHubPRRefreshEvent` → `applyGitHubPRResultToCaches`) the same way.
3. **Add** explicit case: force `no-pr` clears **draft** the same way.
4. **Keep** `"preserves cached merged PR data when a forced no-PR refresh matches the worktree head"` and its event-path twin `"preserves cached merged PR data when a no-PR refresh event matches the worktree head"`.
5. **Keep** confirmed-contained merged preserve test (`"preserves cached merged PR data when the worktree head is a confirmed PR commit"`).
6. **Keep** `"preserves cached PR data when a forced coordinator refresh errors"` (`upstream-error` keeps last good).
7. **Add** regression: open cache + force found merged (if main returns found merged while head still matches) writes merged, not preserve-open.

### Main unit (no behavior change expected for primary fix)

- Existing `shouldHideMergedImplicitPR` / `getPRForBranchOutcome` tests for hide-on-diverge and acceptMergedFallbackPR remain green.
- Do not weaken hide-merged-on-diverge tests as part of the sticky-OPEN fix.

### Optional second-step tests (only if product opts in)

- Main returns found merged + diverge signal instead of bare `no-pr` for branch/fallback after continued commits.
- Cards still hide non-current merged via `isCachedMergedBranchPRCurrentForWorktree`.
- Checks can render MERGED without reintroducing open merge CTA.

### Manual / Electron validation

1. Open a worktree whose PR was squash-merged and HEAD has new commits past the PR head.
2. Checks shows sticky OPEN before the fix (repro).
3. After fix, ↻ clears OPEN; no Squash and merge CTA; empty state shows the create-PR surface (not ambiguous copy); the sidebar worktree card also drops the stale open PR.
4. Checkout the merge commit / PR head and confirm merged state can still appear when head-matched.
5. Airplane-mode / forced upstream error still keeps last good open/merged rather than blanking.

## PR Plan

### PR 1 — Primary sticky-OPEN fix (ship this)

- Narrow `shouldPreserveExistingPRForFallbackMiss` so open/draft are not preserved on authoritative `no-pr` fallback misses.
- Gate the mirrored fallback-miss preserve in `syncHostedReviewCacheFromGitHubPRResult` with the same non-terminal predicate.
- Update github slice unit tests (reverse open preserve on fetch **and** event paths; keep merged head-match, confirmed-contained, and upstream-error).
- Smoke Checks ↻ after merge + diverge; confirm the worktree card also drops the stale open PR.

### PR 2 — Optional MERGED-after-diverge visibility (product gate)

- Only if product wants historical MERGED in Checks after continued commits.
- Thread a found+merged+diverged outcome from `getPRForBranchOutcome` / coordinator consumers.
- Align card filtering so diverge does not pin active review forever.

## Lightweight Eng Review

- **Scope**: two colocated renderer preserve branches — `prCache` predicate + mirrored hosted-review sync (+ tests); main hide-merged-on-diverge stays intentional.
- **Architecture**: preserve force-fetch and fallback-number probing; fix acceptance of null outcomes for non-terminal cache.
- **Failure modes**:
  - sticky OPEN after merge+diverge: fixed by not preserving open/draft on `no-pr`
  - transient errors: still keep last good via `upstream-error`
  - merged-at-head: still preserved via head/contained match
- **Blast radius**: low; risk is over-clearing if any legitimate open path returns `no-pr` spuriously. Mitigate by only changing preserve-on-`no-pr` for non-terminal states, not by changing main lookup success criteria.
- **Residual risks**:
  - The hosted-review sync gate is part of the primary fix (not residual): skipping it deletes the `prCache` entry instead of null-writing it, leaves the worktree card stale-open, and degrades the Checks empty state via the ambiguous-hosted-review path.
  - Optional MERGED-after-diverge remains a product decision; primary fix prefers empty/create PR, matching intentional hide-merged-on-diverge.

## Rollout

1. Land PR 1 with unit coverage first.
2. Validate the two confirmed repro branches / equivalent merge+diverge worktrees in Electron.
3. Only open PR 2 after product chooses historical MERGED visibility after continued commits.

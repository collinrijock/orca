# Stale Terminal Daemon Generation Reaping Design

**Date:** 2026-07-17

**Status:** Proposed implementation plan; first production release is audit-only

**Issue:** [#9138](https://github.com/stablyai/orca/issues/9138)

**Related:** [Terminal Session Ownership and Teardown](../terminal-session-lifecycle.md),
[#9211](https://github.com/stablyai/orca/issues/9211),
[#8585](https://github.com/stablyai/orca/issues/8585),
[#7783](https://github.com/stablyai/orca/issues/7783),
[#8459](https://github.com/stablyai/orca/issues/8459)

## Decision summary

Orca will keep adopting live previous-protocol terminal daemons across app upgrades. It will add the
missing retirement path without treating missing UI or worktree metadata as authority to kill a
process.

The implementation has four independently testable pieces:

1. Persist an exact, versioned ownership claim for every local-daemon session and build a complete
   read-only ownership snapshot across every profile sharing the daemon namespace.
2. Audit unclaimed sessions by daemon and PTY process incarnation, journal candidates, and emit
   content-free diagnostics. The first production release cannot kill sessions or retire legacy
   daemons, even if a runtime flag is set incorrectly.
3. Add exclusive reconciliation, per-session fences, final ownership revalidation, and verified
   retirement for empty legacy daemons. Enforcement ships only after the registered reliability
   gate is promoted using audit evidence.
4. Bump the daemon protocol and let new daemons gracefully self-terminate after 30 minutes with no
   client transports or authenticated clients and no live sessions. This does not infer ownership
   and may ship before app-side enforcement.

The change is eventual cleanup, not cleanup on the first post-upgrade launch. A wanted terminal must
continue to survive app update, ordinary quit, profile switch, sleep, wake, and warm reattach.

## Problem

Daemon generations are keyed by `PROTOCOL_VERSION`. A protocol bump starts a new
`daemon-v<N>` while `createLegacyDaemonAdapters` reconnects to older generations so their live PTYs
remain usable. Normal app quit, update quit, and profile-switch relaunch call `disconnectDaemon()`
instead of `shutdownDaemon()`. That detach behavior is intentional.

There is no corresponding retirement behavior:

- an adopted legacy daemon is not stopped when its last session exits;
- a daemon does not stop itself when its final client and session disappear;
- a session whose pane-to-PTY binding is lost can remain alive but invisible;
- versioned PID, token, and socket artifacts accumulate with each generation.

The #9138 report found four generations, approximately 46 Claude processes behind eight visible
sessions, 370 processes terminated by manual stale-tree cleanup, and 25 GB of swap in use. Local
inspection during this investigation independently found seven obsolete installed-app generations
beside the current generation. At the research snapshot, those eight production-namespace daemon
trees contained 313 descendants and approximately 4.48 GiB resident memory while system swap was
24.36 GiB used. Most active load was under the current daemon, so these counts demonstrate the
resource stakes but are not ownership evidence and do not authorize cleanup. This document does not
use the live installation as a test fixture; all reproduction and validation use disposable profiles
and exact recorded process identities.

## Why the existing cleanup APIs are not sufficient

`DaemonPtyAdapter.reconcileOnStartup(validWorktreeIds)` treats absence from a worktree set as
destructive evidence. Worktree metadata is not a complete session ownership registry: layouts can
be lost while a worktree remains, old workspace forms have different keys, inactive profiles can
still own sessions, and sleep routes intentionally outlive a live PTY.

`cleanupDaemonForProtocol` is also not an idle-retirement primitive. It currently converts a failed
session listing into an empty list and requests `shutdown({ killSessions: true })`. A transient
listing failure must never become permission to kill all sessions in that daemon.

The production reaper will therefore use neither API as its destructive authority. Reconciliation
will accept exact candidate fingerprints and return `kept`, `killed`, or `unknown`. Legacy
retirement will use a separate only-if-proven-empty sequence.

## Terminology

- **Daemon generation:** one local terminal daemon protocol version and its endpoint, PID record,
  and token.
- **Claim:** durable evidence that a profile owns an exact local-daemon protocol/session pair.
- **Legacy protection:** a conservative keep record derived from older persistence whose exact
  protocol or ownership semantics cannot be proven.
- **Route:** an adapter mapping retained so a live, sleeping, or cold-restorable session returns to
  its original daemon generation.
- **Incarnation:** a daemon or session process identified by PID plus an OS process-start identity.
- **Candidate:** an exact unclaimed incarnation observed during a complete audit and recorded in the
  shared candidate journal.
- **Audit mode:** collect and report candidates but issue no session-kill or legacy-shutdown RPC.
- **Enforcement mode:** allow mature candidates and proven-empty legacy daemons to enter destructive
  reconciliation after every safety gate passes.
- **Current daemon:** the daemon using the app's current `PROTOCOL_VERSION`.
- **Legacy daemon:** a connected daemon listed by `PREVIOUS_DAEMON_PROTOCOL_VERSIONS`.

## Goals

1. Preserve every wanted local-daemon session across update, quit, profile switch, folder/floating
   workspaces, sleep/wake, WSL routing, and supported desktop platforms.
2. Detect sessions with no exact durable owner across any profile, including lost-layout sessions
   under a worktree that still exists.
3. Reap only an unchanged, mature, provably unclaimed session incarnation.
4. Retire a legacy daemon after it has no live sessions, retained restoration routes, durable sleep
   claims, or in-flight adapter operations.
5. Let a current-generation daemon exit after a bounded zero-client/zero-session idle period.
6. Keep startup and first-window latency bounded when hundreds of sessions exist.
7. Produce privacy-safe diagnostics sufficient to decide whether enforcement is safe to ship.

## Non-goals

- Do not migrate a live PTY between daemon protocol versions.
- Do not change normal quit, update-quit, or profile-switch detach semantics.
- Do not shut down the current daemon from the app-side legacy reaper.
- Do not infer destructive ownership from a Git worktree scan, path existence, `worktreeMeta`, or
  only the active profile.
- Do not automatically kill a session when any persistence schema or provider observation is
  incomplete.
- Do not make SSH relay or remote-runtime sessions local-daemon candidates. #8585 remains a distinct
  relay-lifecycle problem.
- Do not merge #7783's ordinary app/runtime close-path semantics or #8459's Resource Manager
  false-positive ownership problem into generation retirement. Their safety lessons apply, but their
  lifecycle authorities remain separate.
- Do not add polling. Candidate audits run at bounded lifecycle points; legacy retirement retries are
  event-driven and debounced in the later enforcement slice. The first audit release records
  `retirement-pending` conservatively and clears proven absences, but has no live-stop retry.
- Do not add a UI in the first slice. Existing Manage Sessions behavior remains the manual fallback
  for protected or unsupported legacy sessions.

## Non-negotiable safety invariants

1. **Failure means keep.** An unreadable profile, unsupported schema, failed adapter listing,
   incomplete process probe, failed RPC, or changing source manifest cannot be interpreted as an
   empty successful result.
2. **Ownership is cross-profile.** Destructive absence is valid only after every profile sharing the
   daemon namespace, the legacy root state, and authoritative recovery generations were enumerated.
3. **Ownership is exact.** Current claims match protocol version plus daemon session ID. A legacy
   claim without a derivable protocol matches that session ID in every protocol.
4. **Identity is incarnation-safe.** A session ID or PID alone is never a signal target. Both daemon
   and session identities include process-start identity and must still match immediately before
   action.
5. **Fresh work is outside the snapshot.** Sessions created after the immutable launch snapshot are
   not candidates in that run.
6. **Routes are ownership.** Sleep, wake, cold restore, `keepHistory`, and in-flight attach/create
   operations block retirement even when a daemon temporarily lists zero live sessions.
7. **Exclusive authority is required.** App-side destruction requires the Electron single-instance
   lock and registration of every supported local-daemon client path. Development lock bypass or an
   uncoordinated client forces audit mode.
8. **The audit release is structurally non-destructive.** A runtime feature flag cannot bypass its
   compiled audit-only capability floor.
9. **Cleanup is verified.** Routes, journal entries, PID/token records, and Unix sockets are removed
   only after the exact session or daemon is confirmed absent.
10. **No sensitive diagnostics.** Logs and metrics contain bounded counts and reason categories, not
    session IDs, commands, paths, profile names, terminal output, or process arguments.
11. **Degraded providers are not cleanup targets.** A degraded current provider is not reconciled or
    retired. Other adapters remain keep-only unless ownership and their independent observations are
    complete and healthy.

## Reproduction and validation harness

### Isolation boundary

Add a process-level harness under `tests/e2e/` with concrete daemon-generation naming. It must:

- create its profile and daemon runtime with `mkdtemp`;
- reject a runtime directory equal to or inside the real installed-app or development-app user-data
  directories;
- launch only fixture shells whose full descendant trees are expendable;
- record daemon PID, daemon process-start identity, session ID, session PID, and session process-start
  identity before making assertions or cleaning up;
- terminate only those recorded identities during `finally` cleanup;
- retain bounded logs and state artifacts on failure, with session IDs and paths redacted from normal
  CI output;
- use `path.join` and platform-specific process/endpoint inspection;
- never signal by broad process-name match or delete a shared directory.

The harness should build on `createRestartSession` and the existing daemon preservation E2E tests,
but own a separate two-generation runtime fixture. A process-level fixture starts real daemon entry
subprocesses and talks through real socket/named-pipe RPC. Unit tests may inject clocks and process
inspectors; the release-boundary E2E must not mock daemon RPC or PTY ownership.

### Two-generation topology

The deterministic fixture contains:

```text
temporary userData
├── profiles/profile-a/orca-data.json
├── profiles/profile-b/orca-data.json
└── daemon
    ├── daemon-vN.{pid,token,sock-or-pipe}
    └── daemon-vN+1.{pid,token,sock-or-pipe}

daemon-vN
└── marker shell PTY
    └── mandatory enforcement marker descendant

daemon-vN+1
└── new-generation marker shell PTY
```

For fast PR coverage, daemon construction receives a test-owned protocol dependency while production
continues to use the compile-time constant. The test override is not accepted from production CLI or
environment input. Release validation additionally runs a packaged pre-bump daemon artifact against
the candidate package so compatibility is proven with an actual prior wire implementation.

Marker sessions print a nonce, remain alive without consuming CPU, and expose a second command/reply
after the simulated upgrade. Seeing old output is insufficient because history restoration can replay
it; the post-upgrade reply and unchanged process incarnation prove live adoption.

Slice 0 uses the signed `v1.4.139` macOS arm64 release as the first exact compatibility fixture. It is
the earliest identified protocol-v21 release and was verified against the current protocol-v22
adapter. The release asset is `Orca-1.4.139-arm64-mac.zip` with SHA-256
`e6c391dc05d03b196ad2a9a1ecba691e0edaa0c0cecb862447615580b026245c`. CI downloads it into a
disposable cache and verifies the digest; the 191 MB archive and 522 MB extraction are not committed.
When the implementation bumps to protocol v23, release validation additionally pins the final signed
protocol-v22 package for each platform as the immediate pre-bump fixture.

Enforcement fixtures also start a mandatory marker descendant beneath the candidate session and an
unrelated control process outside that session tree. The product oracle requires the candidate root
and marker descendant to exit while the control remains alive, before harness teardown begins.

### Baseline reproduction

Before product changes, add a test that demonstrates the current bug:

1. Launch daemon vN in the temporary runtime and create a marker PTY.
2. Disconnect the vN client without shutdown, matching ordinary app/update detach.
3. Launch vN+1 against the same runtime and adopt vN through a legacy adapter.
4. Verify both the legacy marker and a new vN+1 marker accept fresh input.
5. Close the legacy marker, wait for its provider exit acknowledgement, and verify vN reports zero
   live sessions.
6. Wait for a test-owned barrier confirming the app's queued provider-exit and daemon-init handlers
   have drained; do not use a fixed sleep as lifecycle synchronization.
7. Assert the vN process and its PID/token/endpoint artifacts remain. This assertion reproduces
   #9138 and must fail after enforcement is enabled.
8. In a second case, remove only the disposable profile's pane binding while leaving its PTY alive;
   verify the process remains alive and is absent from the rendered layout.

The audit-only implementation changes the expected result from “unobserved” to “reported as a
candidate,” while deliberately keeping the process alive. The enforcement test changes the final
expectation only after satisfying the observation and grace gates.

## Proposed architecture

### 1. Persist exact daemon-session claims

Add a versioned `daemonSessionClaims` projection to each profile's persisted state:

```ts
type DaemonSessionClaim = {
  sessionId: string
  ownerKind: 'pane' | 'sleep-route' | 'runtime' | 'retirement-pending'
  workspaceKey: string
  ownerId: string
  provider: 'local-daemon'
  protocolVersion: number
}

type TerminalBindingProvenance =
  | { kind: 'local-daemon'; protocolVersion: number }
  | { kind: 'local-fallback' }
  | { kind: 'remote'; providerId: string }
```

The claim names the physical daemon session, not merely a workspace. Every local-daemon spawn must
commit its binding provenance and claim in the same synchronous state flush before reporting success.
Extend the existing `persistPtyBinding` failure/rollback boundary to renderer-owned panes, split panes,
runtime/headless terminals, and any other audited spawn surface. A failed provenance/claim write fails
the spawn and tears down the newly created PTY. Local fallback and remote spawns persist their own
non-daemon provenance without a daemon claim.

Claim transitions are transactional:

- UI-owned claims are rebuilt from the successfully persisted tab/pane topology.
- Sleep changes `ownerKind` to `sleep-route` without dropping the session ID.
- Wake reuses the claim and updates the protocol only if routing selects a different surviving
  generation.
- Runtime/headless owners persist an explicit owner record; memory-only ownership is not sufficient.
- A close that has removed or is about to remove UI topology first changes the claim to
  `retirement-pending`. That durable record remains a keep claim; only verified exact-generation
  provider absence removes it. Startup does not retry a live claim until the claim schema carries a
  PTY-incarnation token and coordinator fences cover every create/attach path, because a same-ID
  replacement must not inherit stale close intent.
- Individual split-leaf close and destroyed/cancelled in-flight spawn paths obey the same ordering:
  commit `retirement-pending` before dropping topology or transport ownership, then retain it when a
  non-awaited or failed stop is unknown.
- Explicit terminal/worktree retirement removes the claim only after physical stop is confirmed.
- A failed or unknown stop retains the claim.
- A `pane` claim and a binding marked `local-daemon` are one projection; protocol/session disagreement
  or a missing side makes the source incomplete rather than trusting the smaller side. A binding
  marked `local-fallback` or `remote` must not have a daemon claim and is not local-daemon ownership.
  `sleep-route`, `runtime`, and
  `retirement-pending` claims may intentionally have no pane binding and instead validate against
  their owner-specific durable record/state transition.

A natural session exit is a reconciliation trigger, not direct deletion authority. Adapter
subscriptions attach an immutable physical route token containing adapter identity and protocol
before forwarding an exit. The normal and degraded routers mark that route
`exited-pending-reconciliation`; they do not delete it in the event fanout. Legacy exit events contain
no incarnation identity, so the coordinator fences the session ID, settles create/attach/wake and
claim mutations, and performs a healthy listing against the adapter named by the route token. It
removes the exact live claim/binding and pending route only when that session ID is absent and no
sleep/cold-restore route owns it. If a replacement committed before a delayed exit event arrived, the
listing finds it and preserves its binding, claim, and current route. If the daemon itself cannot be
relisted, the transition requires verified absence of that exact daemon process and endpoint before
treating its live sessions as physically stopped. Unknown process state or failed listing retains
every claim and route. A pane that retains history or cold-restore intent keeps an explicit non-live
restoration route rather than a false live-session claim. The same fenced listing/process-absence
rule handles exits that occur while Orca is disconnected on the next launch.

Provider provenance is internal and physical, not inferred from the public PTY ID. Spawn, attach,
discovery, and exit coordination distinguish `{ kind: 'local-daemon', protocolVersion, routeToken }`
from an in-process fallback or a remote provider. Fresh PTYs created by
`DegradedDaemonPtyProvider`'s fallback never receive local-daemon claims, while restored current and
legacy daemon sessions retain their exact protocol provenance. The durable binding projection records
`local-daemon` plus protocol, `local-fallback`, or remote provider identity transactionally, so a raw
inactive-profile read can distinguish a legitimate fallback binding from a missing daemon claim. A
failed listing for any degraded daemon adapter marks that adapter observation incomplete; it is never
normalized to empty.

Worktree IDs, prior-worktree aliases, scope keys, and path parsing may enrich labels and diagnostics,
but they do not participate in a kill decision once exact session claims exist.

Before enforcement, inventory every local-daemon spawn, attach, wake, sleep, close, runtime, CLI, and
headless path. The runtime split-spawn path must pass its `tabId`, `leafId`, and host-session binding
into the same synchronous claim transaction as the primary runtime spawn before UI reveal. A failed
claim commit stops the new physical session. Before a failed reveal removes invisible topology, it
atomically changes the committed claim to `retirement-pending`; failed or unknown stop retains and
retries that claim, and identity-matched verified absence removes it. Each remaining path must either
participate in the transaction or be documented as a blocker that keeps the reliability gate
audit-only.

### 2. Extract conservative ownership from older persistence

Older profiles have no protocol-bearing claim collection. Add versioned read-only extractors that
classify every persisted ID-bearing surface as:

- exact local-daemon ownership;
- local `legacy-protection`;
- remote ownership; or
- non-owning metadata.

Understood ownership includes terminal-tab `ptyId`, split layout
`terminalLayoutsByTabId.ptyIdsByLeafId`, and local migration-protection rows. Agent-provider
conversation/session IDs are not PTY IDs. Remote IDs, pane aliases, and tombstones do not become
local claims merely because they contain an identifier.

Pre-provenance local bindings conservatively emit wildcard `legacy-protection` unless their
schema-specific remote metadata proves they are remote. They cannot distinguish a historical daemon
binding from an in-process fallback, so they are never upgraded to an exact claim. In the new schema,
a missing/malformed binding-provenance row is corruption and makes the source incomplete; it cannot
fall back to guessing from the PTY ID format.

`claudeLivePtySessionIds` is a liveness/authentication sidecar, not automatically an owner. It may be
ignored only when a schema-specific spawn-surface audit proves every legitimate owner is recorded
elsewhere; otherwise each ID produces a conservative protection entry. An unclassified field makes
that schema unsupported. Because older bindings do not identify a protocol, their claims and
protections match every protocol.

The persisted app schema and profile-index schema both remain version `1` across additive ownership
fields, so the extractor routes on raw field presence and shape rather than trusting the version
number to identify historical semantics:

| Raw persisted surface                                                            | Strict local-daemon classification                                                                                                |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `workspaceSession.tabsByWorktree[*][].ptyId`                                     | Scoped SSH IDs are remote; valid bare IDs are wildcard `legacy-protection` because historical bare IDs may be local or SSH.       |
| `workspaceSession.terminalLayoutsByTabId[*].ptyIdsByLeafId`                      | Same ID rules; tab/layout projection conflicts make the source incomplete.                                                        |
| `workspaceSessionsByHostId['ssh:*'/'runtime:*']`                                 | Remote/non-local partition regardless of unprefixed contained IDs; invalid host partitions are incomplete.                        |
| `remoteSessionIdsByTabId`, `activeConnectionIdsAtShutdown`, `sshRemotePtyLeases` | Remote/non-owning for the local daemon.                                                                                           |
| `migrationUnsupportedPtyEntries`                                                 | `source: 'local'` is per-ID wildcard protection; `source: 'ssh'` is remote; missing/invalid source is incomplete.                 |
| `legacyPaneKeyAliasEntries`                                                      | Non-owning alias metadata; malformed known rows are incomplete and aliases never become claims.                                   |
| `claudeLivePtySessionIds`                                                        | Per-ID wildcard protection until historical spawn coverage proves it redundant; read before lossy normalization/capping.          |
| `sleepingAgentSessionsByPaneKey[*].providerSession.id`                           | Agent-provider ID, never a PTY ID. Join through pane/tab to a physical binding; an unresolved local sleeping route is incomplete. |
| SSH tombstones and deleted aliases                                               | Remote identity metadata, not PTY ownership.                                                                                      |
| Worktree/folder/floating/bare-UUID keys, shutdown IDs, history paths             | Labels only; never destructive ownership evidence.                                                                                |

Before a Slice 1 audit may return `complete`, commit raw JSON fixtures for pre/post scoped-SSH IDs,
tab-only/layout-only/split/mismatch projections, host partitions, local and SSH migration rows, aliases,
sidecar-only Claude IDs, joined/unjoined/remote/malformed sleep records, every owner-key form, unknown
ID-bearing fields, mixed-validity collections, stale backups, and unindexed profiles. Existing inline
normalization tests are evidence of current lossy behavior but are not a substitute for raw historical
disk fixtures.

### 3. Build a complete cross-profile ownership snapshot

The daemon namespace is shared under `app.getPath('userData')`, while profile state is stored under
`profiles/<profileId>/orca-data.json`. Add a profile-neutral loader returning an explicit integrity
result:

```ts
type DaemonOwnershipSnapshot =
  | { status: 'complete'; claims: DaemonClaimIndex; sourceRevision: string }
  | { status: 'incomplete'; reasons: string[] }
```

The loader must:

- parse raw profile index, primary, backup, and legacy JSON through strict schema-specific extractors;
  it must not consume `Store`, `readProfileState`, or any normalizer that silently turns malformed
  fields into empty arrays or records;
- read the profile index and over-inclusively enumerate profile directories;
- include unindexed/orphaned profile directories and the legacy root state;
- include local-host partitions and every supported claim schema;
- accept a backup for destructive absence only when recovery metadata proves it is a complete
  committed generation at least as authoritative as the interrupted primary;
- treat a never-used missing profile as complete-empty only when explicit index metadata proves it
  was never initialized and no primary or backup exists;
- return `incomplete` for unreadable state, unsupported schema, malformed claims, enumeration
  failure, or unverifiable recovery state.

Add a monotonic state commit generation and content validation for new primary/backup writes. Existing
unversioned backups remain available for ordinary UI recovery but cannot prove destructive absence.
Normal persistence and direct profile-project writes use one barrier-aware, generation/checksum-bearing
committer; a project transfer cannot bypass the metadata that makes a state generation authoritative.
Before `Store` normalization, startup backfills only the active state file it is about to load. It
does not synchronously enumerate inactive profiles; their missing commit metadata keeps the bounded,
post-first-window audit incomplete rather than delaying first paint or manufacturing authority.
Legacy inactive profiles are migrated one at a time when an explicit profile operation opens them.
Completed-transfer receipt recovery is also released after first window load (or headless provider
readiness), so it cannot turn that on-demand path back into a synchronous startup namespace scan.
The optional pre-profile root state is committed at that same post-window boundary before audit,
because it remains a conservative snapshot source even after its active-profile copy is created.

Profile project movement participates in the namespace mutation barrier. A move writes rekeyed daemon
claims and sleeping-route records to the target profile before deleting them from the source. Before
the target write, the source durably commits a pending transfer operation ID naming source, target,
and project identity; the target commit carries the same lineage. A retry with matching lineage
resumes source deletion and final lineage cleanup, while an unrelated pre-existing target duplicate
is a non-destructive conflict. A crash between commits may leave duplicate keep claims, never a gap or
a permanently indistinguishable half-move. A copy operation strips physical PTY bindings and
sleeping-route records from the copied topology and does not copy a live-session claim because two
profiles cannot independently own the same physical session. Transfer tests cover pending-operation
write failure, destination-write failure, source-write failure, crash after target commit, retry to
completion, unrelated duplicates, and final-lineage cleanup.

A `Store` instance that recovered by falling back to default state is not a complete ownership
snapshot. Destructive callers consume the explicit loader integrity result; they never infer success
from Store construction or an empty `worktreeMeta` map.

Optimistic audits compare source manifests before and after extraction. The manifest covers profile
index content, sorted profile-directory entries, legacy state, and selected state generations. A
change retries the audit or returns `incomplete`; timestamps alone are not a revision protocol. Final
destructive revalidation runs under the reconciliation mutation barrier.

### 4. Snapshot and journal candidates by incarnation

Daemon startup already lists adapters while discovering legacy/degraded routes. Reshape
`discoverLegacySessions()` and `discoverDaemonSessions()` to return one full `SessionInfo` inventory
per successfully connected adapter instead of discarding PID detail. The same immutable inventory
must seed routing, seeded-live-PTY reconciliation, and the audit snapshot; do not add another
swap-time listing. Do not put post-swap sessions into that run's candidate set. After provider swap
and first-window release, batch-resolve process-start identities and perform at most one background
re-list per adapter to confirm unchanged pairs before journaling them.

Protocol v23 binds that inventory to the authenticated endpoint: both hello sockets return daemon
PID, the exact startup timestamp written to the PID record, and the per-launch nonce. The client
requires both sockets to agree, and the audit compares the hello identity with the PID record before
and after relisting. Older protocols cannot self-report this identity, so they remain observable and
adoptable but make candidate journaling incomplete. Binding legacy endpoints is an explicit
pre-enforcement requirement; a protocol-only PID filename is not sufficient evidence.

A fingerprint contains:

```ts
type DaemonReapCandidateFingerprint = {
  protocolVersion: number
  daemonPid: number
  daemonStartedAt: string
  sessionId: string
  sessionPid: number
  sessionStartedAt: string
}
```

`SessionInfo.createdAt` is not an identity source while `TerminalHost.listSessions()` reports zero.
Process inspection uses a dedicated destructive tri-state API; it must not reuse daemon health's
`startTimeMatches()` behavior because that adoption helper intentionally treats a missing start time
as a match. The destructive API returns a probe-level success/failure plus, for every requested PID,
exactly one of `observed(token)`, `not-observed`, `ambiguous`, or `unknown`. A successful process-table
snapshot that omits a PID is only `not-observed`, not proof of process absence; the adapter re-list
decides whether the session disappeared, and a still-listed PID without an observed token is
unkillable.

Platform tokens and batching are explicit:

- **macOS:** run one bounded asynchronous full-table
  `ps -axo pid=,lstart=` with `LANG=C`, `LC_ALL=C`, and `TZ=UTC0`, then filter locally. Reject duplicate
  PID rows and identities born in the capture second. The locale and timezone settings are part of the
  identity contract because both changed `lstart` text in experiments.
- **Linux:** read `/proc/<pid>/stat` field 22 asynchronously in bounded chunks and pair the raw start
  ticks with `/proc/sys/kernel/random/boot_id`. Do not spawn `getconf` or convert through boot time for
  every PID.
- **Windows:** query at most 256 validated PIDs per PowerShell/CIM batch, concurrency one, selecting
  `ProcessId` and `CreationDate` with invariant serialization. Use a strict timeout and buffer bound,
  UTF-8 output, and `windowsHide: true`. A failed batch makes the entire chunk unknown; an omitted or
  null-creation row makes only that PID unknown.

Every final enforcement scan must start after its candidate fence is acquired; a completed TTL
snapshot cannot be reused. Native Windows enforcement remains blocked until the exact batched query
passes the Windows 10/11 validation described below.

Persist candidates in an atomically replaced, schema-versioned, profile-neutral journal under the
shared daemon runtime directory. Apply user-only permissions/ACLs, a bounded entry count, and strict
validation. Missing, corrupt, future-version, rolled-back-clock, or implausibly future-dated journal
state restarts observation and never authorizes a kill.

Enforcement eligibility requires all of the following:

- the candidate appeared unclaimed in at least two distinct complete launch audits;
- its unchanged fingerprint is older than a compiled minimum of seven days;
- configuration has not shortened the minimum (it may lengthen it);
- the current ownership snapshot remains complete and unclaimed;
- the adapter and process probes remain healthy;
- the build and both exact reliability-gate contracts allow enforcement.

A matching exact claim, legacy wildcard, protection entry, fingerprint change, or incomplete
observation removes or suspends the candidate. Dead identities are garbage-collected from the journal
without issuing a kill.

### 5. Coordinate and fence destructive reconciliation

Add one reconciliation coordinator per shared user-data daemon namespace. It owns:

- whether the normal Electron single-instance lock grants destructive authority;
- registration of all local-daemon client construction;
- profile creation/deletion and claim-commit mutation barriers;
- create/attach/wake routing fences for an exact session ID;
- adapter retiring state and in-flight operation counts.

Every supported daemon-client constructor must register with this coordinator. A same-user process
that obtains the private daemon token and impersonates Orca is outside this cleanup contract; normal
Orca code must not leave an unregistered construction path as though it were external abuse.

The initial client registry explicitly covers the long-lived adapter client in
`daemon-pty-adapter.ts`, the short-lived health/session-count client and cleanup client in
`daemon-init.ts`, the standalone client in `daemon-pty-provider.ts`, authenticated raw health clients
in `daemon-health.ts`, and unauthenticated endpoint probes in both `daemon-init.ts` and
`daemon-health.ts`. The raw connection inventory includes the low-level socket site in `client.ts` and
every production `connect()` site in those two modules. The latter two client categories are bounded
non-creation clients: their request surface cannot issue create, attach, kill, or shutdown, but their
in-flight lifetimes still register so retirement does not close an endpoint beneath them.
If the standalone provider is truly unused, remove it; otherwise it remains an enforcement blocker
until registered. A static constructor/raw-socket audit fails when a new daemon endpoint client
bypasses registration or expands a non-creation allowlist with a state-changing request. The existing
cleanup client's list-failure-to-empty behavior is never reachable from reaping or retirement
authority.

For each mature candidate:

1. Acquire destructive reconciliation authority; otherwise keep it.
2. Fence create/attach/wake for the exact session ID and wait for already-started operations to
   settle within a bound.
3. Enter the claim/profile mutation barrier and build a fresh complete ownership snapshot.
4. Re-list the owning adapter; failure returns `unknown`.
5. Verify daemon PID/start identity, protocol, session ID/PID/start identity, and absence of exact,
   wildcard, or protection claims.
6. Issue the adapter kill. An RPC failure returns `unknown` and retains route and journal entry.
7. Re-list the same verified adapter. Remove only this route and journal entry after confirmed
   absence.
8. Release the barrier and fence. Waiting callers retry normal routing.

The fence prevents an old session from exiting and a wake/reattach from creating a new incarnation
under the same ID between verification and kill. Other terminal I/O remains available; the final
barrier is short and bounded.

When final process identity inspection requires an external process, fence only a small bounded group
of mature candidates, resolve their identities in one platform batch, and then run the per-candidate
sequence. Timeout or error releases all remaining fences. This avoids one PowerShell launch per
session without expanding the race window.

### 6. Retire a proven-empty legacy daemon

Legacy retirement is disabled in audit mode. In enforcement mode it runs after launch discovery and
is retried, with debounce, when a legacy session exits or the final restoration route/claim is
removed.

Under exclusive supported-client authority:

1. Enter the namespace barrier and mark the adapter `retiring` so new selection cannot target it.
2. Wait for its in-flight operations to settle.
3. Build a fresh complete all-profile ownership snapshot under the mutation barrier.
4. Require zero live sessions and zero retained live/sleep/cold-restore routes or claims for the
   protocol. A legacy wildcard sleep route or protection entry blocks every legacy protocol.
5. Disconnect the routed adapter and open a bounded cleanup client tied to the same verified daemon
   identity.
6. Perform a final session listing. Failure or a non-empty result aborts retirement and reinstalls
   the adapter before releasing the barrier.
7. After a successful final zero listing, send shutdown, verify the exact daemon process exited, and
   remove its PID/token records and Unix socket. A Windows named pipe is not unlinked as a file; its
   disappearance is verified after server exit.
8. Remove the adapter from the router and unsubscribe its data, exit, and background listeners only
   after verified process exit.

A wedged legacy daemon is not empty merely because RPC failed. PID fallback is allowed only after a
zero-session attestation bound to the same verified daemon identity and while exclusive client
authority plus every route/operation fence remains held. Otherwise retirement aborts and preserves
the process and artifacts for a later safe attempt.

Passing `killSessions: false` is not an idle guarantee because current shutdown disposes the terminal
host. Exclusive authority across final list and shutdown is what closes the create race for old
protocols that cannot implement an atomic `shutdownIfIdle` RPC.

### 7. Add idle self-shutdown to the new protocol

Bump `PROTOCOL_VERSION`; already-running legacy daemons cannot gain daemon-baked behavior.

The spawner gives the daemon its PID-record path plus a random per-launch instance nonce and writes
that nonce beside PID/start identity in the record. This is constructor/launch plumbing, not a public
CLI or environment override. It lets self-shutdown distinguish its own PID record from a stale or
replacement record.

The new daemon server reevaluates idleness when either the last client transport/authenticated client
disconnects or the final live session exits. Pending handshake sockets count as clients. When every
transport/client count and the session count are zero it arms a 30-minute timer. Socket acceptance
cancels the timer before authentication, and session create/attach cancels it before work starts.

On expiry the daemon atomically enters `idle-shutdown-pending`, so the connection handler rejects new
admission with retryable unavailable/reconnect behavior and create/attach is fenced. Without awaiting,
it rechecks pending transports, authenticated clients, and sessions. A pre-fence admission or session
aborts shutdown and clears the fences. Otherwise it synchronously initiates server close so no new
socket is accepted before any awaited host/artifact cleanup. A post-fence connection is never admitted
and silently torn down: it is explicitly rejected or observes the closed endpoint and retries.

While the exact server handle still owns the closing endpoint, shutdown removes the token and reads
back the PID record, unlinking that record only when PID plus launch nonce match its exact self
identity; a missing, malformed, stale, or replaced record is preserved. It then drains/disposes the
host, closes/removes the platform endpoint, and exits. A live background agent is a live session and
prevents the timer from arming. Ordinary cleanup failure may leave a harmless artifact for later
identity-checked scavenging, but it cannot broaden which record is removed or keep a zero-session
daemon alive indefinitely.

Unit tests use an injected clock. Process-level tests configure a short test-only duration through
direct construction; production CLI/environment input cannot shorten the 30-minute policy.

## Expected module boundaries

Final names may adjust to existing ownership boundaries, but modules must remain concrete and
single-purpose. Do not create generic `helpers` or `utils` modules.

| Area                                                    | Expected responsibility                                                    |
| ------------------------------------------------------- | -------------------------------------------------------------------------- |
| `src/main/persistence.ts` and terminal spawn callers    | Transactional claim projection and rollback                                |
| `src/main/daemon/daemon-session-claims.ts`              | Claim schema, validation, and exact matching                               |
| `src/main/daemon/daemon-ownership-snapshot.ts`          | Cross-profile enumeration and integrity result                             |
| `src/main/daemon/daemon-reap-candidate-journal.ts`      | Bounded atomic candidate persistence                                       |
| `src/main/daemon/daemon-session-process-incarnation.ts` | Fail-closed batched platform process-incarnation inspection                |
| `src/main/daemon/daemon-reconciliation-coordinator.ts`  | Authority, barriers, fences, and operation registration                    |
| `src/main/daemon/legacy-daemon-retirement.ts`           | Proven-empty retirement sequence                                           |
| `src/main/daemon/daemon-pty-router.ts`                  | Retiring state, route checks, and adapter removal                          |
| `src/main/daemon/daemon-spawner.ts` and PID record      | Per-launch instance nonce and self-cleanup ownership metadata              |
| `src/main/daemon/daemon-server.ts`                      | Atomic current-generation idle shutdown and matching self-artifact cleanup |
| `src/main/daemon/types.ts`                              | Protocol bump and compatible wire types                                    |
| `src/main/orca-profiles/`                               | Complete profile index/directory snapshot inputs                           |
| `tests/e2e/daemon-generation-reaping.spec.ts`           | Disposable two-generation process harness                                  |
| `config/reliability-gates.jsonc`                        | Startup prerequisite and dedicated reaping promotion gate                  |

Any module approaching the max-lines limit is split by these domain boundaries. No max-lines disable
or per-file limit increase is allowed.

## Rollout and implementation sequence

### Slice 0: deterministic reproduction

- Land the isolated two-generation harness and a baseline test that proves empty legacy daemons
  survive indefinitely today.
- Extend the existing live-session preservation E2E as the positive control.
- Record bounded process/artifact evidence without changing product behavior.

### Slice 1: durable ownership and audit-only observation

- Add exact claims, `retirement-pending`, strict raw legacy extraction, the common state committer,
  project-transfer semantics, and cross-profile snapshots.
- Put renderer/runtime/headless spawn paths inside the durable transaction and carry physical daemon
  provenance through degraded routing and every persisted binding; unsupported paths make the audit
  incomplete.
- Add immutable raw snapshots, batched identity enrichment, candidate journal, and content-free
  diagnostics.
- Hard-code the production capability floor to audit-only.
- Keep all candidate sessions and legacy daemons alive.
- Keep `terminal-provider.daemon-startup-degraded-contract` as a required prerequisite and add a
  dedicated experimental `terminal-provider.daemon-generation-reaping-contract` gate for the
  destructive lifecycle. Audit builds collect evidence for both; neither authorizes enforcement.
- The current implementation stops at audit scaffolding: its startup-diagnostic milestone is not
  aggregatable production telemetry. Slice 1 is not accepted or promotion-ready until every bounded
  counter in Diagnostics is emitted through a privacy-reviewed production path.
- Startup reconciles `retirement-pending` only when an exact-generation list proves absence. Live or
  unknown entries stay as keep claims; physical retry remains a Slice 2 identity/fencing deliverable.

### Slice 2: coordinator and retirement mechanics, still audit-only

- Register every enumerated daemon client, profile writer, and ownership mutation with the
  coordinator, backed by static inventory tests.
- Preserve immutable adapter/protocol route tokens through exit-pending reconciliation in both normal
  and degraded routers.
- Add per-session fences, explicit router retirement APIs, and dry-run retirement eligibility.
- Exercise the full destructive sequence only in tests with enforcement injected directly.
- Prove that production audit builds cannot enter it.

### Slice 3: new-protocol idle shutdown

- Bump the protocol and add the atomic 30-minute idle policy.
- Ship independently if its unit, process, and packaged validation pass because it acts only when
  both client and session counts are zero.

### Slice 4: enforcement release

- Review aggregated audit counters and incomplete-reason rates.
- Promote `terminal-provider.daemon-startup-degraded-contract` from `protection: "none"` as required
  by the reviewed implementation contract, and independently promote the dedicated generation-reaping
  gate through the repository process.
- Enable mature-session reaping and legacy retirement in a separate release capability.
- Preserve a remote rollback to audit mode. Rollback never makes the ownership schema destructive;
  it only stops kill/retirement attempts.

## Diagnostics

Emit bounded counters through the existing daemon milestone path:

- ownership snapshot complete/incomplete and reason categories;
- profiles and state-source counts;
- adapters and sessions audited;
- exact claims and legacy protections found;
- first-seen, grace-pending, fingerprint-changed, claimed, protected, killed, and unknown candidates;
- legacy retirement eligible, attempted, aborted-by-route, aborted-by-session,
  aborted-by-unknown, and completed;
- audit duration, manifest retry count, process-probe batch count, and adapter RPC count.

Counters must have explicit caps. Do not emit IDs, paths, names, commands, output, or unbounded reason
strings. Audit work starts after provider swap and first-window release.
The current audit milestone does not yet satisfy this contract because it is startup-diagnostics
gated and omits several lifecycle and cost categories. That gap is an explicit enforcement blocker,
not evidence that the counters are optional.
The raw snapshot reader processes files sequentially, fails incomplete above 64 MiB aggregate input
or 512 profiles per capture, and never retains an unbounded set of concurrent file reads. Desktop
releases the audit from the first `did-finish-load`; headless serve uses local-provider readiness as
the equivalent release boundary.

## Reliability and performance contracts

The existing `terminal-provider.daemon-startup-degraded-contract` remains a prerequisite because a
degraded startup must preserve provider identity. It is not, by itself, authorization to kill a
session. Add `terminal-provider.daemon-generation-reaping-contract` with the following complete
contract before Slice 1 is accepted:

- **Invariant:** only an unchanged, mature session incarnation with no exact/protected owner in a
  complete shared-namespace snapshot can be killed; only a proven-empty legacy daemon can retire.
- **Failure source:** #9138 and duplicate #9211.
- **Oracle:** fresh input proves wanted legacy sessions survive. Exact process-exit and
  descendant-exit events prove only the candidate tree stopped. Verified daemon exit and
  endpoint/artifact absence prove retirement.
- **Gate:** the dedicated experimental generation-reaping gate plus the validated startup-degraded
  prerequisite. Enforcement checks both exact gate IDs and their approved protection levels.
- **Coverage:** local daemon on macOS/Linux/Windows; WSL classified by actual provider;
  SSH/remote/mobile marked unaffected and protected from local interpretation.
- **Diagnostics:** bounded milestone counts and reason categories defined above.
- **Owner:** `terminal-provider`.
- **Maturity:** audit commands start experimental, move to soak with machine-recorded runtime/flake
  history, and become enforcement-capable only through a recorded promotion.
- **Demotion:** any unauthorized signal, false candidate, unexplained flake, incomplete-source kill
  attempt, or budget regression immediately returns enforcement to audit-only.
- **Residual gaps:** every unsupported schema, unregistered client, unowned spawn surface, or missing
  platform identity probe remains an explicit enforcement blocker.

The dedicated gate owns commands, test files, assertion references, red/green evidence, covered
platforms/providers, runtime history, known gaps, promotion criteria, and the demotion record. A
non-`none` protection string without that matching contract does not authorize enforcement.

Use deterministic count budgets in addition to timing measurements:

- zero all-profile filesystem reads, external identity probes, or candidate-journal writes are
  awaited on the first-window critical path;
- startup performs exactly one full inventory RPC per successfully connected adapter, reusing it for
  discovery, routing, seeded-live reconciliation, and the immutable audit snapshot;
- background enrichment performs at most one re-list per audited adapter; final enforcement is
  serialized and performs at most one pre-kill and one post-kill listing per candidate;
- Windows process probes contain at most 256 requested identities per batch, run with concurrency one,
  and spawn no more than `ceil(identityCount / 256)` PowerShell processes. Linux uses bounded `/proc`
  reads without an external process. macOS uses one bounded full-table `ps` snapshot per audit phase
  and projects only requested PIDs; it must not use `ps -p` chunks merely to satisfy the Windows cap;
- the candidate journal retains at most 4,096 entries or 4 MiB, whichever limit is reached first;
- reaching either journal limit makes that audit incomplete and grants no kill authority; do not
  truncate to a partial candidate set or evict an older entry as though its grace were preserved;
- overflow atomically replaces the active journal with a valid `reset-required` marker containing no
  candidates, and every candidate restarts its observation/grace period after capacity returns. If
  that marker cannot be durably committed and read back, the old journal is not kill authority for
  the current launch and enforcement remains disabled;
- there is at most one debounced legacy-retirement timer per daemon namespace and one idle timer per
  daemon, with no reconciliation polling;
- enforcement concurrency starts at one candidate. Raising it requires new latency evidence and a
  gate update.

The 400-session benchmark compares the same packaged build with audit capability disabled and
enabled. Pass requires first-window p95 to remain within the larger of 5% or 100 ms of baseline,
main-process peak RSS within 64 MiB of baseline, and surviving-marker key-echo p95 within the larger
of 10 ms or 10% of baseline with an absolute ceiling of 50 ms. No audit task may create an event-loop
stall above 50 ms. These are initial release ceilings; tightening is allowed, while loosening requires
an explicit gate review with new evidence.

The initial macOS process-probe experiment ran on a host with approximately 1,195 processes. Thirty
full-table scans had 30.9 ms median, 32.5 ms p95, and 32.5 ms maximum duration; parsing approximately
41.8 KiB took 0.29 ms median and 0.65 ms p95, with 3.35 ms maximum measured event-loop delay. Targeted
256-PID `ps -p` queries were slower and unstable: median measurements ranged from 134.8 ms to 829.5 ms
and p95 reached 1.28 seconds. These results choose the full-table macOS strategy but do not replace the
packaged 400-session release benchmark.

## Verification and validation plan

### A. Ownership extraction unit tests

- Collect current exact claims from a single pane, split panes, folder workspaces, folder-project
  instances, floating sessions, bare UUID sessions, sleep routes, and runtime/headless owners.
- Match current claims only on protocol plus session ID.
- Require every new binding to carry durable `local-daemon`, `local-fallback`, or remote provenance;
  only local-daemon bindings require an exact matching claim.
- Treat legacy bindings without protocol as wildcard keep claims.
- Join sleeping records to pane PTY bindings; never convert agent-provider conversation/session IDs
  into daemon claims.
- Classify every legacy ID-bearing field. Local migration protection keeps its ID; remote IDs, pane
  aliases, and tombstones do not become local ownership.
- Prove `claudeLivePtySessionIds` is either redundant for that schema or emits per-ID legacy
  protection.
- Mark unknown schema, unclassified fields, malformed collections, and disagreement between `pane`
  claims and local-daemon pane bindings incomplete; validate fallback/remote bindings and non-pane
  claim kinds against their own durable owner records without requiring a daemon claim or live pane.
- Treat pre-provenance ambiguous local bindings as wildcard protection; treat missing provenance in a
  new-schema binding as incomplete rather than inferring from ID shape.
- Feed malformed raw fields through the snapshot loader and prove no Store/profile normalizer can
  silently convert them to complete-empty ownership.
- Retain a claim after failed or unverifiable physical stop; remove it only after confirmed stop.
- A removed pane with a failed or unknown stop retains a `retirement-pending` keep claim; startup
  clears it only after exact-generation absence and never retries an identity-incomplete live ID.
- Produce no claim for a lost layout even when `worktreeMeta` remains.
- Do not use the existing 30-day missing-worktree grace as a session claim.

### B. Cross-profile snapshot unit and filesystem tests

- Include indexed profiles, unindexed profile directories, inactive profiles, local-host partitions,
  and legacy root state.
- Treat an explicitly never-initialized profile as empty only with no primary or backup.
- Return incomplete for unreadable index/directory, corrupt primary and backups, malformed claim
  collection, or unsupported schema.
- Reject a merely parseable unversioned/stale backup as destructive authority.
- Accept a backup only with valid content metadata and an authoritative commit generation.
- Retry or invalidate when profile index, directory membership, or selected state generation changes
  between source manifests.
- Prove a corrupt inactive profile blocks both session reaping and empty legacy retirement for the
  shared namespace.
- Prove profile A's claim protects its session while profile B is active.
- Project moves commit a durable source operation ID, rekey claims and sleeping routes into a target
  carrying matching lineage, then delete the source and clear lineage. Pending-operation failure,
  destination failure, source failure, crash-after-target plus retry, and final cleanup may duplicate
  protection but never create a gap; retry completes matching lineage while an unrelated duplicate
  remains a conflict. Project copy strips physical PTY bindings and does not duplicate live claims or
  sleeping routes.
- Normal Store writes and direct profile-project writes both produce the same validated commit
  generation/checksum metadata under the mutation barrier.

### C. Transaction and spawn-surface tests

- A successful local spawn commits the pane binding and exact claim before returning.
- A failed claim write tears down the newly spawned PTY and returns spawn failure.
- Renderer split, primary runtime, runtime split, headless, CLI-created, and restored terminals follow
  the same contract. Runtime split passes host `tabId`/`leafId` before spawn returns and rolls back a
  failed claim commit. Reveal failure atomically commits `retirement-pending` before topology removal;
  kill failure/unknown survives restart and clears only after verified physical absence; a live retry
  requires the later incarnation-token and coordinator-fence contract.
- Sleep changes claim kind without dropping identity; wake preserves or transactionally replaces the
  protocol.
- Profile switch flushes profile A claims before disconnect and does not transfer them to profile B.
- Explicit terminal/worktree close removes a claim only after confirmed provider stop.
- Individual split-leaf close, destroyed/cancelled in-flight spawn, tab close, worktree shutdown,
  folder removal, and forget-local persist `retirement-pending` before discarding topology or
  transport ownership; non-awaited, asynchronous, or all-settled kill failure leaves that protection
  durable across restart, and an identity-matched verified absence clears it.
- A connected natural exit removes only the exact live claim after a fenced, identity-matched adapter
  listing confirms absence, while retaining any explicit history/cold-restore route.
- A natural exit while Orca is disconnected clears the old live claim on the next healthy,
  identity-matched absence listing.
- Failed listing or delayed stop confirmation retains the claim until a later healthy confirmation.
- Natural-exit reconciliation uses one bounded retry burst per physical daemon provenance, then keeps
  the claim and route dormant with no timer. A later successful physical inventory or provider rebind
  wakes the retained exits and batches them behind one listing.
- Session-ID reuse racing either transition preserves the new incarnation and its claim.
- A replacement claim committed before delayed legacy exit delivery survives because the fenced
  re-list sees the replacement; the exit event alone never clears persistence.
- A deterministic cross-socket ordering test holds the legacy stream exit event, completes replacement
  creation and claim commit over the control path, then releases the event and proves the replacement
  binding and claim survive.
- Normal and degraded routers attach immutable adapter/protocol route tokens before forwarding exit,
  retain an exited-pending route through reconciliation, and preserve a `keepHistory` route even when
  the physical session exits during sleep.
- Degraded fallback spawns receive no local-daemon claim; discovered current/legacy sessions retain
  physical protocol provenance, and one failed adapter discovery makes only that observation
  incomplete rather than empty.
- Crash/restart and inactive-profile raw extraction distinguish a persisted fallback binding with no
  daemon claim from a corrupted local-daemon binding whose required claim is missing.
- If the owning daemon is gone, claims transition only after its exact process and endpoint absence
  are verified; unknown daemon state retains them.
- Concurrent spawn and profile write cannot expose a live session without either a claim or a failed
  spawn rollback.
- Downgrade/upgrade tests prove additive state remains readable and older app behavior cannot turn an
  unsupported future claim schema into destructive absence.

### D. Candidate journal and identity tests

- First complete observation writes a candidate but cannot kill it.
- A second distinct complete launch before seven days remains grace-pending.
- A candidate becomes eligible only after two complete launch audits and the compiled seven-day
  minimum.
- A user upgrading directly to an enforcement-capable build with no journal still receives both
  observations and the minimum grace.
- Configuration may lengthen but cannot shorten the grace period.
- Corrupt, missing, future-version, oversized, or permission-invalid journal state restarts
  observation without kill authority.
- Entry-count and encoded-byte boundary tests cover limit minus one, exact limit, and first overflow.
  Overflow must make the whole audit incomplete, issue no kill, atomically persist only the
  `reset-required` marker, preserve no partial/evicted authority, and restart every grace period when
  capacity returns. Marker write/readback failure also issues no kill.
- Clock rollback or implausible forward time restarts the affected grace period.
- Reuse of session ID with a new PID survives.
- Reuse of both session ID and numeric PID with a different process-start identity survives.
- Daemon PID reuse with a different start identity invalidates every candidate for that daemon.
- Sessions spawned after the immutable swap snapshot never enter the current candidate set.
- Identity enrichment journals only ID/PID pairs still present in a fresh listing.
- Dead candidates are garbage-collected without a kill RPC.
- The destructive resolver never calls the fail-open daemon-health start-time matcher and represents
  probe failure, `not-observed`, duplicate/ambiguous rows, and an observed token distinctly.
- Linux tokens combine boot ID with raw `/proc/<pid>/stat` start ticks; cover commands containing `)`,
  boot-ID change, malformed stat, and bounded 0/1/256/257-PID reads.
- macOS parsing covers C/UTC output, locale/timezone changes, malformed/duplicate rows, capture-second
  identities, partial process exit during the scan, timeout, and buffer overflow.
- Windows parsing covers empty/singleton/array/malformed JSON, null creation dates, omitted PIDs,
  timeout, buffer overflow, `windowsHide`, 0/1/256/257 batching, and sequential batch execution.
- A final enforcement probe starts after its fence and cannot consume a completed cached snapshot.
- Batched process probes return per-entry unknown for partial results.

### E. Coordinator and final-kill tests

- Lack of single-instance authority, development lock bypass, or one unregistered daemon client keeps
  the run audit-only.
- Static inventory fails if adapter, health/count, cleanup, standalone-provider, authenticated raw
  health, unauthenticated probe, or future endpoint construction bypasses registration; non-creation
  allowlists reject state-changing RPCs, and the unused standalone provider is removed or keeps the
  gate audit-only.
- A create/attach/wake already in flight settles before the fence decision.
- A new operation for the fenced session waits and retries after release.
- A claim/profile mutation beginning during final validation waits for the barrier.
- A claim added between audit and enforcement keeps the candidate and removes it from the journal.
- Adapter listing or process-probe failure returns `unknown` and sends no kill RPC.
- Kill-RPC failure retains the route and journal record.
- Post-kill listing failure or a still-live result retains the route and reports `unknown`.
- Only confirmed absence removes the exact route and journal entry.
- Fencing one session does not pause terminal I/O for unrelated sessions.
- Timeouts release every acquired fence and barrier.

### F. Sleep, wake, and route tests

- `keepHistory: true` retains the adapter mapping and prevents retirement.
- A live legacy session that sleeps after provider swap becomes a protected zero-live-session route.
- A durable sleep claim in an inactive profile blocks its protocol's retirement.
- A legacy-wildcard sleep route or protection entry blocks every legacy protocol.
- Wake/reattach reusing a session ID cannot be killed by the old incarnation's fingerprint.
- Removing a legacy adapter unsubscribes its listeners without removing routes for other adapters.
- Natural exit does not erase the adapter route before fenced identity-matched reconciliation.
- The final route removal schedules one debounced retirement retry and does not start polling.

### G. Empty legacy daemon retirement tests

- Audit mode reports an otherwise eligible daemon but issues no shutdown.
- Zero sessions, routes, claims, and in-flight operations retire the verified daemon in enforcement
  tests.
- A session appearing between initial and final listing aborts retirement and survives.
- Final listing failure is unknown, never empty.
- A retained cold-restore route or inactive-profile sleep claim blocks retirement.
- Missing exclusive client authority blocks retirement after a successful zero listing.
- A racing registered create either finishes before the final list or waits until the adapter is
  restored; it cannot win between list and shutdown.
- Shutdown failure or unverified daemon exit retains artifacts and adapter state for later recovery.
- PID/token files and a Unix socket are removed only after verified process exit.
- Windows verifies named-pipe disappearance instead of unlinking a path.
- Session exit and last-route removal cause eventual debounced retirement during a long-running app.
- Connected natural exit and next-launch detached-exit confirmation both clear the exact live claim
  and allow the final retirement retry; unknown listing leaves the daemon protected.

### H. Current-daemon idle shutdown tests

- Last pending transport/authenticated client disconnect with zero sessions arms the timer.
- Last session exit after all clients disconnected arms the timer.
- Raw socket acceptance before authentication, authenticated client connection, create, or attach
  cancels an armed timer.
- A live foreground shell or background agent prevents the timer from arming.
- Expiry fences client admission plus create/attach, atomically rechecks transport/client/session
  counts, and synchronously stops accepting before awaited cleanup.
- A deterministic barrier holds cleanup after the recheck while racing raw connect/auth and
  create/attach. Pre-fence work aborts shutdown and remains usable; post-fence clients receive
  retryable unavailable/reconnect behavior and are never admitted then silently disconnected.
- Successful expiry gracefully stops the exact daemon and removes its matching token, PID record,
  and platform endpoint.
- PID-record cleanup requires the exact process PID plus per-launch nonce; missing/malformed records
  and stale or replacement PID/nonce records are never unlinked.
- Unix socket cleanup runs on macOS/Linux; Windows closes its named pipe without file unlink logic.
- Fake-clock unit tests cover boundary minus one millisecond, exact expiry, cancellation, and re-arm.
- A real process test uses a short constructor-injected duration and verifies process exit plus token,
  matching PID-record, and endpoint cleanup on every platform.

### I. Failure-injection validation

- Corrupt active and inactive profile primaries and backups independently.
- Deny reads for one profile/index/directory enumeration.
- Mutate a profile and create/delete a profile during optimistic audit.
- Return unsupported future schema and malformed claim entries.
- Fail one adapter's list while others succeed.
- Enter degraded current-provider mode and prove neither its sessions nor daemon become candidates.
- Stop or wedge a legacy daemon between probe, final list, and shutdown.
- Reuse session and daemon PIDs with different start identities in the fake inspector.
- Fail claim commit after PTY spawn.
- Fail kill RPC, post-kill listing, shutdown RPC, process-exit verification, and artifact removal.
- Bypass the single-instance lock and construct an intentionally unregistered test client.
- Move the test clock backward and implausibly forward.

Every failure above must assert both the reported reason and the absence of an unauthorized signal or
shutdown RPC.

### J. Disposable Electron E2E matrix

Run serially with isolated profiles. Each spec is owned by `terminal-provider`, starts as
`experimental`, advances to non-blocking `soak` only with recorded red/green evidence, and is demoted
on an unexplained flake or false signal. Playwright timeouts bound test failure but are never the
lifecycle oracle.

1. **Upgrade preservation**
   - **Invariant:** a wanted vN PTY remains routed through its original adapter after vN+1 starts.
   - **Oracle/wait:** a fresh post-upgrade nonce returns from the unchanged session incarnation after
     the explicit legacy-route-ready milestone.
   - **Red/green:** disabling legacy-adapter registration makes the nonce/identity assertion fail;
     normal adoption passes.
2. **New routing**
   - **Invariant:** a post-swap spawn belongs only to vN+1 and cannot enter vN's immutable candidate
     set.
   - **Oracle/wait:** wait for spawn acknowledgement and audit-complete; inspect both daemon
     inventories and the content-free candidate count.
   - **Red/green:** seeding the audit from a post-swap inventory fails the exclusion assertion.
3. **Ordinary quit/update detach**
   - **Invariant:** normal detach preserves a wanted PTY and its claim.
   - **Oracle/wait:** wait for app disconnect acknowledgement, relaunch route-ready, then receive a
     fresh nonce from the same process identity.
   - **Red/green:** replacing detach with shutdown fails the identity and fresh-input assertions.
4. **Cross-profile ownership**
   - **Invariant:** inactive profile A protects its session while profile B is active.
   - **Oracle/wait:** wait for both profile commits and audit-complete, verify no kill RPC, switch back,
     and receive fresh input from A's unchanged session.
   - **Red/green:** an active-profile-only snapshot makes the no-kill/fresh-input oracle fail.
5. **Lost layout and descendant reap**
   - **Invariant:** worktree metadata alone cannot protect an unclaimed incarnation, while unrelated
     processes remain outside the reaper's authority.
   - **Oracle/wait:** wait for two complete audit milestones and test-clock maturity, then for the
     exact kill and post-kill absence milestones; before teardown assert the candidate shell and its
     mandatory descendant exited while the unrelated control process remains alive.
   - **Red/green:** the audit build keeps both candidate processes; the enforcement build kills only
     the matured candidate tree. Current pre-fix behavior never reaches the reap oracle.
6. **Sleep race**
   - **Invariant:** a retained sleep/cold-restore route blocks legacy retirement.
   - **Oracle/wait:** wait for the persisted sleep claim and retirement-aborted-by-route milestone,
     wake, then receive a fresh nonce from the valid route.
   - **Red/green:** ignoring retained routes either retires the daemon or fails wake/fresh input.
7. **Empty legacy retirement**
   - **Invariant:** audit mode never shuts down, while enforcement retires only after the final route,
     claim, session, and operation disappear.
   - **Oracle/wait:** wait for exit/claim commits and retirement-decision; assert audit eligibility
     leaves the PID alive, then in enforcement wait for exact process-exit and artifact-removal
     milestones.
   - **Red/green:** current behavior leaves the empty daemon alive; a deliberately injected late
     session makes retirement abort and preserves it.
8. **Corrupt inactive profile**
   - **Invariant:** incomplete cross-profile ownership is never destructive absence.
   - **Oracle/wait:** wait for audit-incomplete with the expected reason; assert zero kill/shutdown
     RPCs and receive fresh input from every marker.
   - **Red/green:** treating parse failure as empty makes the RPC/fresh-input oracle fail.
9. **Process reuse**
   - **Invariant:** an old fingerprint cannot kill a replacement incarnation reusing logical and
     numeric IDs.
   - **Oracle/wait:** wait for fingerprint-changed, assert zero kill RPC for the replacement, and
     receive its fresh nonce.
   - **Red/green:** ID-only matching kills the replacement and fails the nonce oracle.
10. **Plain idle quit**
    - **Invariant:** an empty current daemon exits only after the zero-client/zero-session idle state.
    - **Oracle/wait:** wait for idle-armed, advance the constructor-injected test clock, then wait for
      exact process exit and endpoint removal before relaunching normally.
    - **Red/green:** the pre-idle-shutdown daemon remains alive; a late client cancels the timer and
      preserves connectivity.

Product assertions run before `finally` cleanup. Harness cleanup then verifies no recorded fixture
daemon or marker descendant remains, uses only exact recorded identities, and leaves diagnostic
artifacts under the test output directory on failure.

### K. Packaged update validation

For macOS, Linux, and Windows CI or release candidates:

1. Install/launch a baseline package with protocol vN under a disposable OS user/profile.
2. Create claimed, sleeping, and deliberately unclaimed marker sessions.
3. Quit normally so the daemon remains detached.
4. Launch the candidate vN+1 package against the same disposable user data.
5. Verify claimed and sleeping sessions survive and accept new input through the legacy adapter.
6. Verify new sessions route to vN+1.
7. Verify the audit build reports but does not kill the unclaimed session or retire vN.
8. For an enforcement test build only, mature the candidate through the test-owned clock/journal
   boundary, rerun final validation, and before harness cleanup verify only the unclaimed session root
   and its mandatory descendant are killed while an unrelated control process remains alive.
9. Close the final retained legacy route and verify vN exits and exact artifacts disappear.
10. Quit with an empty vN+1 daemon and verify its idle self-shutdown.

Windows assertions use PID records and named-pipe connectivity. macOS/Linux assertions use PID/start
identity plus Unix socket state. WSL sessions remain local-provider claims, but path/Git detection is
never negative ownership evidence.

### L. SSH and remote-runtime validation

- Persist remote session IDs beside local claims and prove they never enter the local candidate
  index.
- Fail SSH/relay/remote-runtime observation and prove it does not authorize local cleanup.
- Exercise an SSH-backed worktree whose terminal is locally hosted and verify ownership follows the
  actual provider, not path shape.
- Preserve #8585 relay teardown behavior and existing remote-runtime owner routing unchanged.

### M. Scale, performance, and soak validation

- Audit a fixture with at least 400 sessions across multiple generations and profiles, matching the
  reported process scale.
- Assert exactly one startup inventory per connected adapter, one background enrichment re-list per
  audited adapter, and at most two serialized final listings per enforcement candidate.
- Repeat the inventory-count assertion with seeded Claude live-PTY IDs and in degraded mode so
  reconciliation cannot quietly add another startup listing.
- Assert Windows process identities use batches of at most 256 with concurrency one and obey the
  probe-count formula; Windows must not spawn one PowerShell process per session. Assert Linux uses
  no external identity process and macOS uses one bounded full-table snapshot per audit phase rather
  than targeted `ps -p` chunks.
- Measure startup-to-first-window with audit disabled, audit enabled, and the 400-session fixture.
  Snapshot enrichment and journaling must remain off the first-window critical path and satisfy the
  p95 regression ceiling above.
- Record audit duration, peak RSS, event-loop delay, adapter RPC count, probe subprocess count,
  journal entries, and journal bytes; fail the gate when any contract ceiling is exceeded.
- Limit enforcement concurrency so descendant termination cannot stall typing in a surviving marker
  terminal; measure key echo latency during a reap batch against the stated p95 and absolute ceilings.
- Run a multi-day or accelerated soak covering repeated protocol upgrades, profile switches,
  sleep/wake, candidate churn, and daemon idle exits. The number of empty generations and stale
  artifacts must converge to zero in enforcement mode.
- Confirm journal and diagnostics remain bounded under repeated incomplete audits.

### N. Static and repository validation

Add source-inventory tests that fail when a daemon client constructor or raw daemon endpoint client
is not registered with the coordinator for its full in-flight lifetime, a non-creation raw-client
allowlist can issue a state-changing request, or a profile-state writer bypasses the common
generation/checksum committer. These tests name the allowed construction/write sites explicitly so a
newly added path cannot silently leave the reliability gate green.

Run after focused tests pass:

```sh
pnpm exec vitest run --config config/vitest.config.ts <focused daemon and persistence tests>
pnpm run test:e2e -- <focused daemon-generation specs>
pnpm run typecheck
pnpm run lint
pnpm run check:max-lines-ratchet
pnpm run check:reliability-gates
pnpm run build:desktop
```

Also verify the packaged daemon entry through the existing packaging check and run platform-specific
packaging validation where CI provides the host. Do not paper over failures with lint disables,
max-lines exemptions, or platform skips unless the behavior is genuinely platform-inapplicable and
the complementary platform test exists.

### O. Audit-release field validation and enforcement gate

Before enforcement:

1. Ship at least one production release with a compiled audit-only floor.
2. Aggregate privacy-safe counters by app version and platform.
3. Confirm profile enumeration and ownership extraction complete successfully at the required rate;
   investigate every recurring incomplete category.
4. Confirm candidate fingerprints remain stable across the seven-day window and that later claims
   correctly remove candidates.
5. Confirm audit work does not regress startup, typing latency, or daemon RPC health.
6. Confirm there are no code paths constructing daemon clients or committing claims outside the
   coordinator.
7. Attach command-backed prerequisite evidence to
   `terminal-provider.daemon-startup-degraded-contract` and destructive-contract evidence to
   `terminal-provider.daemon-generation-reaping-contract`.
8. Promote both exact gate contracts only through the repository's recorded promotion process.
9. Review the enforcement diff separately and prove its production capability cannot be activated
   in older audit-only builds.

Enforcement does not ship if any supported schema, profile source, spawn surface, client constructor,
sleep route, or process-identity implementation remains unaudited.

## Acceptance criteria

The work is complete only when:

- the baseline harness reproduces #9138 without touching real user data;
- wanted legacy sessions survive upgrades and accept fresh input;
- all local-daemon sessions have durable exact claims or conservative legacy protection;
- incomplete ownership always produces keep/audit-only behavior;
- audit production builds cannot issue candidate kills or legacy shutdowns;
- mature enforcement candidates are killed only after fenced final incarnation and ownership checks;
- empty legacy daemons retire eventually and verified artifacts are removed;
- empty new daemons self-terminate after the production idle interval;
- cross-profile, sleep/wake, WSL, Windows, macOS, Linux, SSH, and remote-provider boundaries pass the
  validation matrix;
- the 400-session audit stays off the first-window critical path and satisfies the stated
  resource/RPC ceilings;
- the startup prerequisite and dedicated reaping gate have machine-recorded evidence and are both
  promoted before enforcement;
- no max-lines disable, generic module name, platform path assumption, or sensitive diagnostic is
  introduced.

## Rollback and recovery

- Session reaping and legacy retirement share an enforcement capability that can be rolled back to
  audit without changing claims or killing anything.
- Current-daemon idle shutdown is separately gated because it does not infer ownership. If rolled
  back, a new launch simply reconnects to the still-running generation.
- Candidate journal corruption or downgrade incompatibility discards kill authority and restarts the
  grace period.
- Unsupported future persistence causes incomplete ownership and keeps all sessions.
- Failed legacy retirement restores/reconnects the adapter when the daemon remains alive.
- Artifact deletion is best-effort only after verified exit; leftover artifacts are safe for later
  identity-checked garbage collection.

## Resolved pre-implementation research

- The process-incarnation API and platform token formats are defined above. macOS full-table probing
  was measured locally; Linux uses boot-ID/start-tick tokens; Windows has a concrete bounded CIM
  design but remains non-enforcing until native validation passes.
- The exact protocol-v21 baseline fixture is signed `v1.4.139` with the digest recorded above. The
  immediate pre-bump fixture policy is to pin the final signed protocol-v22 package when v23 is cut.
- Current spawn/lifecycle inventory identified the runtime split transaction, exit-route provenance,
  retirement-pending closes, profile project transfer, degraded physical-provider provenance, and
  every current daemon-client constructor. Those paths are now explicit requirements above rather
  than implicit audit assumptions.
- Historical persistence inventory found that app and profile-index schemas remain version `1`
  across additive fields. The raw field-by-field classifications are recorded above; version alone is
  never destructive authority.

## Remaining implementation and promotion questions

These must be resolved during Slice 0/1 without weakening the invariants:

1. Have all mandatory raw historical fixtures and strict extractor cases in the catalog above landed?
   Until then Slice 1 scaffolding runs incomplete/audit-only and cannot report a complete ownership
   snapshot.
2. Does the proposed 256-PID PowerShell/CIM query meet its cold/warm latency, partial-result, command
   length, timezone/DST, sleep/resume, and Defender timeout contracts on supported Windows 10/11
   hosts? This blocks Windows enforcement, not audit-only implementation.
3. What audit completion rate and soak duration are required for promotion? The initial performance
   ceilings are defined above; the gate record owns measured history and any tightening.

None of these questions permits a destructive fallback. Until each applicable answer is validated,
the corresponding namespace remains audit-only.

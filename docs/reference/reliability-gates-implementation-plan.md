# Reliability Gates Implementation Plan

Date: 2026-07-01

Source context: [`docs/reference/reliability-pain-points-2026-06-30.md`](./reliability-pain-points-2026-06-30.md).

## Goal

Prevent the recent terminal, tab, session, startup, provider, and performance regressions from escaping again by turning each high-risk reliability class into a small executable gate with explicit maturity, owner, runtime budget, flake history, and promotion evidence.

This plan is intentionally narrower than the full pain-points review. The first milestone proves the operating model end to end before Orca adds more tests.

## Operating Rules

- Add gates only when they protect a named invariant tied to a real issue, PR, or accepted gap.
- Prefer deterministic unit or provider-contract tests over Electron UI tests when the lower layer proves the user-visible invariant.
- Never promote a gate to blocking until it has red/green evidence, stable runtime evidence, and a named demotion rule.
- Keep stress/torture runs non-blocking unless they have deterministic oracles and flake history.
- Include a performance or crash-safety budget whenever the protected change touches terminal throughput, hidden panes, persistence, startup, polling, subprocesses, git/worktree scans, SSH, WSL, or Windows paths.

## Milestone 1

Milestone 1 creates the reliability-gate loop with the two highest-leverage escaped classes:

1. `terminal-session.snapshot-freshness`
   A stale local/daemon liveness snapshot cannot close a newer PTY binding.

2. `agent-session.provider-ownership`
   Workspace activation, restore, sleep, hibernate, dedupe, clearing, or reconnect code cannot replay or resume a provider session already owned, queued, pending, or live in the workspace.

Both gates already have targeted tests in the repo. Milestone 1 makes them reviewable factory artifacts by registering their invariant, command, owner, maturity, known gaps, and promotion criteria in `config/reliability-gates.jsonc`.

## First Commands

Run the structural manifest check:

```sh
pnpm run check:reliability-gates
```

Run the first two gate tests:

```sh
pnpm exec vitest run --config config/vitest.config.ts \
  src/renderer/src/components/terminal-pane/terminal-dead-session-reconcile.test.ts \
  src/renderer/src/lib/resume-sleeping-agent-session.test.ts
```

Run the existing terminal perf report gate before promoting terminal lifecycle gates to blocking:

```sh
pnpm run test:e2e:terminal-perf:scale:report
```

## Promotion Criteria

A gate can move from `experimental` to `soak` when:

- it is registered in the manifest;
- it has a deterministic oracle with no blind sleeps;
- it has a cheap command that can run repeatedly;
- it names the failure artifact reviewers should inspect;
- it has a clear owner and demotion rule.

A gate can move from `soak` to `blocking` when:

- it has red/green evidence against the old behavior, a regression fixture, or an intentionally broken variant;
- it has at least 100 consecutive passing soak runs or 14 days of required-platform CI history, whichever is more appropriate for the gate;
- p95 runtime is within the manifest budget;
- there are zero unexplained flakes in the promotion window;
- any required perf/git-crash budget has measured evidence.

## Factory Contract

`brennan-yolo-lite`, `review-code`, `perf`, and `git-crash-perf` should treat the manifest as the source of truth.

For any PR touching a P0-capable surface, the agent or reviewer should:

- identify the touched reliability class;
- name the matching manifest gate or accepted gap;
- run the gate command or explain why it does not apply;
- require a new manifest entry when the PR introduces a new reliability class;
- invoke `perf` or `git-crash-perf` when the touched surface matches their risk scope.

## Milestone 2

After Milestone 1 works, add the next three gates as experimental entries with deterministic harnesses:

- `terminal-geometry.visible-convergence`
- `xterm-addon.boundary-containment`
- `startup-upgrade.persisted-session-corpus`

These should not become blocking until the team has red/green, runtime, and flake evidence. The goal is fewer useful gates, not a larger noisy suite.

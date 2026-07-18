# Bug reproduction — Pass 2 (2026-07-18)

Continuation of the 2026-07-15 handoff pass ([README.md](./README.md)). macOS host. Orchestrated via triage + repro sub-agent workflows over the open `bug`-labeled issues not already labeled `has_repro`/`cannot_repro` and not already covered by an open fix PR.

Every reproduced bug ships a **runnable pinning vitest test** that imports the real product modules and asserts the current (buggy) behavior — re-run it to confirm the defect still exists. GitHub issues were commented + labeled.

## Scope this pass

| Bucket | Count | Label |
|--------|------:|-------|
| Reproduced (runnable proof) | 23 | `has_repro` |
| Not reproduced (fixed/no-defect on current tree) | 9 | `cannot_repro` |
| Partial (root cause proven, full path needs live app/host/account) | 9 | commented, unlabeled |
| OS-blocked (Windows/Linux/mobile) | 27 | [PASS2-OS-BLOCKED.md](./PASS2-OS-BLOCKED.md) |
| Needs-info (cannot attempt) | 30 | [PASS2-NEEDS-INFO.md](./PASS2-NEEDS-INFO.md) |
| Not-a-bug / duplicate / already-fixed | 30 | [PASS2-NOT-A-BUG.md](./PASS2-NOT-A-BUG.md) |
| Live-app, not yet attempted | 11 | [PASS2-LIVE-APP-TODO.md](./PASS2-LIVE-APP-TODO.md) |
| Skipped — already had an open fix PR (actively worked) | 37 | — |

## REPRODUCED — `has_repro` (runnable proof committed)

| Issue | Title | Re-run |
|------:|-------|--------|
| [9297](https://github.com/stablyai/orca/issues/9297) | [Bug]: Startup hangs (up to ~5min) or crashes on Windows | `pnpm exec vitest run --config config/vitest.config.ts src/main/ipc/repro-9297-where-per-agent-probe.test.ts` |
| [9206](https://github.com/stablyai/orca/issues/9206) | [Bug]: The environment variables ORCA_ROOT_PATH and ORCA | `pnpm exec vitest run --config config/vitest.config.ts src/main/repro-9206-wsl-setup-env-not-crossing.test.ts` |
| [9171](https://github.com/stablyai/orca/issues/9171) | [Bug]: Wrong PR diffs displayed when checking out the de | `pnpm exec vitest run --config config/vitest.config.ts src/main/github/repro-9171-default-branch-stale-pr.test.ts` |
| [8259](https://github.com/stablyai/orca/issues/8259) | [Bug] Orca doesn't recognize a Cursor agent session in t | `pnpm exec vitest run --config config/vitest.config.ts src/shared/repro-8259-cursor-node-wrapper.test.ts` |
| [7797](https://github.com/stablyai/orca/issues/7797) | [Bug]: Agents running inside a user's tmux session are n | `pnpm exec vitest run --config config/vitest.config.ts src/main/providers/repro-7797-tmux-agent-detection.test.ts` |
| [7732](https://github.com/stablyai/orca/issues/7732) | [Bug]: GitLab pipeline job details never load in the Che | `pnpm exec vitest run --config config/vitest.config.ts src/shared/repro-7732-gitlab-job-id-dropped.test.ts` |
| [7710](https://github.com/stablyai/orca/issues/7710) | [BUG] OMP fresh launches can resume a previous session a | `pnpm exec vitest run --config config/vitest.config.ts src/shared/repro-7710-omp-fresh-session.test.ts` |
| [7623](https://github.com/stablyai/orca/issues/7623) | Headless PR merge routing: same #6957 bug in PullRequest | `pnpm exec vitest run --config config/vitest.config.ts src/renderer/src/components/repro-7623-readpath-clobber.test.ts` |
| [7521](https://github.com/stablyai/orca/issues/7521) | [Bug]: Codex session history can duplicate because AI Va | `pnpm exec vitest run --config config/vitest.config.ts src/main/ai-vault/repro-7521-codex-runtime-home-duplicate.test.ts` |
| [7429](https://github.com/stablyai/orca/issues/7429) | [Bug]: `worker_done` with null taskId/dispatchId silentl | `pnpm exec vitest run --config config/vitest.config.ts src/main/runtime/orchestration/repro-7429-worker-done-null-ids.test.ts` |
| [7400](https://github.com/stablyai/orca/issues/7400) | [Bug]: Orca Mobile can show stale one-tab session when m | `pnpm exec vitest run --config config/vitest.config.ts src/main/runtime/repro-7400-mobile-snapshot-version.test.ts` |
| [7331](https://github.com/stablyai/orca/issues/7331) | [Bug]: PR details fail to load for fork repositories — g | `pnpm exec vitest run --config config/vitest.config.ts src/main/github/repro-7331-fork-pr-owner-repo.test.ts` |
| [7047](https://github.com/stablyai/orca/issues/7047) | [Bug] Agent is marked as "Done" when the CLI is not inst | `pnpm exec vitest run --config config/vitest.config.ts src/main/runtime/repro-7047-cli-missing-marked-done.test.ts` |
| [6988](https://github.com/stablyai/orca/issues/6988) | [Bug]: System SSH probe fails on GitHub with "Invalid co | `pnpm exec vitest run --config config/vitest.config.ts src/main/ssh/repro-6988-github-restricted-shell-probe.test.ts` |
| [6072](https://github.com/stablyai/orca/issues/6072) | [Bug]: Mobile keeps showing old agent rows after termina | `pnpm exec vitest run --config config/vitest.config.ts src/main/runtime/repro-6072-stale-worktree-ps.test.ts` |
| [5611](https://github.com/stablyai/orca/issues/5611) | [Bug]: Copying selected Copilot conversation text shows  | `pnpm exec vitest run --config config/vitest.config.ts src/renderer/src/components/terminal-pane/repro-5611-copy-success-unverified.test.ts` |
| [4642](https://github.com/stablyai/orca/issues/4642) | [Bug]: npx skills add --global silently fails the Prompt | `pnpm exec vitest run --config config/vitest.config.ts src/shared/repro-4642-global-skill-install.test.ts` |
| [4630](https://github.com/stablyai/orca/issues/4630) | [Bug]: Claude-Mem Causes Spam of Notifications even if " | `pnpm exec vitest run --config config/vitest.config.ts src/renderer/src/components/terminal-pane/repro-4630-claude-mem-renotify.test.ts` |
| [4389](https://github.com/stablyai/orca/issues/4389) | [Bug]: Multiple orchestrators in a single workspace kill | `pnpm exec vitest run --config config/vitest.config.ts src/main/runtime/rpc/methods/repro-4389-coordinator-global-ownership.test.ts` |
| [1715](https://github.com/stablyai/orca/issues/1715) | [Bug]: GitHub Projects uses the wrong gh host in multi-h | `pnpm exec vitest run --config config/vitest.config.ts src/main/github/repro-1715-multi-host-projects.test.ts` |
| [5399](https://github.com/stablyai/orca/issues/5399) | [Bug]: Limits always shows 5h regardless of reset time | `pnpm exec vitest run --config config/vitest.config.ts src/renderer/src/components/status-bar/repro-5399-collapsed-reset-label.test.tsx` |
| [7209](https://github.com/stablyai/orca/issues/7209) | [Bug]: SSH host terminal size does not match the pane (a | `pnpm exec vitest run --config config/vitest.config.ts src/relay/repro-7209-ssh-attach-ignores-client-size.test.ts` |
| [7740](https://github.com/stablyai/orca/issues/7740) | [Bug]: Either not following CLAUDE_CONFIG_DIR or not loa | `pnpm exec vitest run --config config/vitest.config.ts src/main/claude-accounts/repro-7740-config-dir-launch-snapshot.test.ts` |

### Batch re-run
```bash
pnpm exec vitest run --config config/vitest.config.ts \
  src/main/ipc/repro-9297-where-per-agent-probe.test.ts \
  src/main/repro-9206-wsl-setup-env-not-crossing.test.ts \
  src/main/github/repro-9171-default-branch-stale-pr.test.ts \
  src/shared/repro-8259-cursor-node-wrapper.test.ts \
  src/main/providers/repro-7797-tmux-agent-detection.test.ts \
  src/shared/repro-7732-gitlab-job-id-dropped.test.ts \
  src/shared/repro-7710-omp-fresh-session.test.ts \
  src/renderer/src/components/repro-7623-readpath-clobber.test.ts \
  src/main/ai-vault/repro-7521-codex-runtime-home-duplicate.test.ts \
  src/main/runtime/orchestration/repro-7429-worker-done-null-ids.test.ts \
  src/main/runtime/repro-7400-mobile-snapshot-version.test.ts \
  src/main/github/repro-7331-fork-pr-owner-repo.test.ts \
  src/main/runtime/repro-7047-cli-missing-marked-done.test.ts \
  src/main/ssh/repro-6988-github-restricted-shell-probe.test.ts \
  src/main/runtime/repro-6072-stale-worktree-ps.test.ts \
  src/renderer/src/components/terminal-pane/repro-5611-copy-success-unverified.test.ts \
  src/shared/repro-4642-global-skill-install.test.ts \
  src/renderer/src/components/terminal-pane/repro-4630-claude-mem-renotify.test.ts \
  src/main/runtime/rpc/methods/repro-4389-coordinator-global-ownership.test.ts \
  src/main/github/repro-1715-multi-host-projects.test.ts \
  src/renderer/src/components/status-bar/repro-5399-collapsed-reset-label.test.tsx \
  src/relay/repro-7209-ssh-attach-ignores-client-size.test.ts \
  src/main/claude-accounts/repro-7740-config-dir-launch-snapshot.test.ts
```

## NOT REPRODUCED — `cannot_repro` (verified fixed / no defect on current tree)

| Issue | Title | Note |
|------:|-------|------|
| [8075](https://github.com/stablyai/orca/issues/8075) | [Bug]: Markdown editor does not support numeric superscr | Fixed by #8307 (superscript link node) |
| [7323](https://github.com/stablyai/orca/issues/7323) | [Bug]: Injected Claude Code hooks (agent-flow/hook.js) h | Injected hooks already carry timeout:10 |
| [7038](https://github.com/stablyai/orca/issues/7038) | [Bug] Claude Code terminal waiting for user to select 1/ | Focus emits only focus-reports, never Enter |
| [7232](https://github.com/stablyai/orca/issues/7232) | [Bug]: Appearance language is changed after each install | i18n language-init fixed on tree |
| [7118](https://github.com/stablyai/orca/issues/7118) | [Bug] Opening or closing sidebar will reset terminal scr | performSafeFit restores viewport (fixed) |
| [6698](https://github.com/stablyai/orca/issues/6698) | [Bug]: Vietnamese Telex input in integrated terminal los | Vietnamese Telex forwarding fixed (#6682) |
| [6905](https://github.com/stablyai/orca/issues/6905) | [Bug]: Vietnamese IME Input Broken in Terminal | Vietnamese IME forwarding fixed (#6682) |
| [5919](https://github.com/stablyai/orca/issues/5919) | [Bug] Pasting | Paste routed through planTerminalPasteWithYield (fixed) |
| [7905](https://github.com/stablyai/orca/issues/7905) | [Bug]: Unable to use the opencode terminal | No code defect; suspect opencode binary/PATH — needs live env |

## PARTIAL (root cause proven; full product path needs live app/host/account — unlabeled)

| Issue | Title | Blocked on |
|------:|-------|-----------|
| [7431](https://github.com/stablyai/orca/issues/7431) | [Bug]: `worktree create` hard-errors offline when base r | offline worktree-create throw path (unit pins bad ref-candidate list) |
| [5657](https://github.com/stablyai/orca/issues/5657) | [Bug]: macOS — startup PATH probe hangs (unkillable, req | macOS Endpoint-Security-managed host (unit pins -ilc probe) |
| [5370](https://github.com/stablyai/orca/issues/5370) | [Bug]: Orca's private `CODEX_HOME` causes a Codex auth-r | live OpenAI account to observe token revocation |
| [5024](https://github.com/stablyai/orca/issues/5024) | [Bug]: Purple File Names not Clickable | live app fs pathExists gate (unit pins single-cwd anchoring) |
| [9204](https://github.com/stablyai/orca/issues/9204) | [Bug]: Undo (Ctrl+Z / Cmd+Z) fails in Diff View after sa | Monaco diff editor live save/undo |
| [9040](https://github.com/stablyai/orca/issues/9040) | [Bug] No processing indicators | live sidebar working-status render (unit pins normalize gap) |
| [4643](https://github.com/stablyai/orca/issues/4643) | [Bug]: Jira connector — can't create an issue from Orca; | live Jira token + create form |
| [4396](https://github.com/stablyai/orca/issues/4396) | Bug: Linear and GitHub issue Use actions force new works | Linear half (GitHub half already fixed on tree) |
| [6106](https://github.com/stablyai/orca/issues/6106) | SSH terminal loses pre-TUI shell output after Codex tab  | live SSH TUI alt-screen snapshot restore |


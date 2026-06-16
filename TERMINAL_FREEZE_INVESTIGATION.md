# Terminal freeze / renderer memory spike investigation

## Context

User report: on macOS Orca 1.4.70, terminals sometimes become unresponsive while typing. Existing terminals appear frozen, and newly-created terminals show only a blank cursor instead of the usual shell prompt line. The same user also reported renderer memory spiking to ~1.2GB.

This investigation is on branch `terminal-freeze-after-renderer-memory-spike`.

## Current diagnostic files

Diagnostic E2E files intentionally kept in this worktree:

- `tests/e2e/helpers/terminal-liveness-diagnostics.ts`
- `tests/e2e/terminal-background-pressure-liveness.spec.ts`

These are opt-in pressure/benchmark harnesses. The broader memory-pressure and scrollback-reflow probes were removed from the PR surface after they helped rule out non-root causes.

## What we ruled out

- Raw renderer memory pressure alone did not reproduce terminal breakage.
- Visible sibling terminal output pressure did not reproduce the freeze.
- Large scrollback resize/reflow was locally modest and did not explain the reported symptom.
- WebGL/GPU context loss was not observed in the strongest repro; WebGL stayed active.

## Strongest repro so far

Command shape:

```sh
ORCA_E2E_TERMINAL_CROSS_WORKSPACE_PRESSURE=1 \
ORCA_E2E_TERMINAL_BACKGROUND_PANES=17 \
ORCA_E2E_TERMINAL_BACKGROUND_PRESSURE_MIB_PER_PANE=4 \
ORCA_E2E_TERMINAL_BACKGROUND_PROBES=4 \
ORCA_E2E_TERMINAL_LIVENESS_TIMEOUT_MS=10000 \
npx playwright test tests/e2e/terminal-background-pressure-liveness.spec.ts \
  --grep "another workspace" \
  --config tests/playwright.config.ts \
  --project electron-headful \
  --workers=1
```

Baseline after rebasing onto current `main`:

- Active terminal remains technically alive, but echo/liveness latency climbed roughly:
  - ~22ms → ~308ms → ~1684ms → ~2971ms
- Renderer scheduler backlog reached ~8.2M chars.
- Renderer memory climbed substantially during the run.
- Main→renderer counters showed hidden output flowing through the renderer path.

With a 2s liveness timeout, the same scenario can fail as `pty-backend-not-echoing`, then recover later. This matches the user-facing “terminal feels frozen” class of symptom.

## Important implementation finding

Current main has a hidden-output restore path in:

- `src/renderer/src/components/terminal-pane/pty-connection.ts`

But the skip gate currently only applies to a narrow hidden Codex/startup case:

```ts
!shouldSnapshotHiddenCodexOutput
```

So ordinary hidden shell terminals in another workspace can still stream live bytes into renderer/xterm work.

## Experiment 1: broaden renderer-side hidden output skipping

Experimental change:

- Let snapshot-capable hidden local PTYs skip renderer xterm writes, not just hidden Codex startup output.
- Mark hidden renderer state dirty and restore from the main-owned buffer when visible.

Measured effect after rebuild:

- Renderer scheduler backlog collapsed from ~8M chars to near-zero.
- Renderer memory stayed much lower, around ~300–370MiB instead of rising toward ~800MiB+ in the same test.
- Main→renderer pending/in-flight counters also improved once hidden renderer delivery was gated.

But the active terminal could still miss a 2s liveness probe even when:

- `schedulerQueuedChars = 0`
- `mainPendingChars = 0`
- `mainRendererInFlightChars = 0`

Conclusion: renderer/xterm/IPC delivery was a major memory/backlog contributor, but not the whole freeze.

## Experiment 2: deliberately lossy hidden runtime/headless skip

Temporary experiment only — do **not** ship:

- In `src/main/ipc/pty.ts`, before runtime/headless processing, skip hidden local PTY data entirely when the renderer pane is hidden.
- Still mark hidden renderer output skipped.

Measured effect:

- The 2s repro passed.
- Active terminal latency stayed around ~10ms / ~500ms / ~500ms / ~10ms.
- Renderer memory stayed around ~296–307MiB.
- App total memory stayed around ~703–727MiB.

Conclusion: the remaining freeze after renderer gating is caused by main/runtime work, most likely `OrcaRuntime.trackHeadlessTerminalData()` parsing every hidden output chunk through the headless xterm emulator.

Relevant code:

- `src/main/ipc/pty.ts`
  - local provider `onData`
  - `runtime?.onPtyData(...)`
- `src/main/runtime/orca-runtime.ts`
  - `onPtyData`
  - `trackHeadlessTerminalData`
  - `serializeMainTerminalBuffer`
- `src/main/daemon/headless-emulator.ts`
  - `HeadlessEmulator.write`

## Current best root-cause model

This is not primarily a GPU renderer death.

The strongest model is:

1. Many hidden/cross-workspace terminals produce high-volume output.
2. Orca processes that hidden output as if the terminals still need live renderer/headless state.
3. Renderer-side xterm work creates memory/backlog pressure.
4. Even after renderer work is avoided, main/runtime headless xterm parsing can still monopolize enough time that active PTY echo is delayed beyond 2s.
5. The terminal is not permanently dead; it is starved/backpressured and later recovers.

## Prototype code currently in worktree

There is prototype code for:

- `pty:setVisibleRendererPty`
- `pty:rendererOutputSkipped`
- main-side hidden local PTY renderer-delivery suppression
- renderer-side restore notification wiring

Files touched:

- `src/main/ipc/pty.ts`
- `src/preload/api-types.ts`
- `src/preload/index.ts`
- `src/renderer/src/components/terminal-pane/pty-connection.ts`
- `src/renderer/src/components/terminal-pane/pty-dispatcher.ts`
- `src/renderer/src/components/terminal-pane/pty-transport.ts`
- `src/renderer/src/components/terminal-pane/use-terminal-pane-lifecycle.ts`
- `src/renderer/src/web/web-preload-api.ts`

Also touched incidentally:

- `src/renderer/src/components/tab-bar/TabBar.windows-shell-launch.test.ts`
  - Removed a duplicate mocked `useCallback` property after rebasing main.

Validation so far:

```sh
pnpm run typecheck:web
```

passed after removing the duplicate `useCallback` mock.

## What not to ship

Do not ship the lossy hidden runtime/headless skip. It proves the root cause, but it drops hidden terminal history/status and would break restore/mobile/read correctness.

## Likely final fix direction

The safer fix is a two-level hidden terminal strategy:

1. Renderer side:
   - Do not send/parse hidden local PTY output through renderer xterm live.
   - Mark hidden renderer state dirty.
   - Restore from a main-owned snapshot when the pane becomes visible.

2. Main/runtime side:
   - Do not synchronously parse every hidden high-volume PTY chunk through the headless xterm emulator while another terminal is active.
   - Buffer hidden output cheaply with caps / sequence metadata.
   - Preserve enough tail/status/restore information to avoid losing user-visible terminal history.
   - Defer or budget headless parsing, then catch up when:
     - the hidden pane becomes visible,
     - a mobile/client snapshot is requested,
     - `orca terminal read` needs the output,
     - or the PTY exits and final state must be persisted.

The final solution needs regression coverage proving:

- 17+ hidden/cross-workspace streaming PTYs do not delay active terminal echo beyond the target budget.
- Renderer queue and renderer memory stay bounded.
- Hidden panes restore visible output when shown.
- TUI/alternate-screen restore still works.
- `orca terminal read --limit` and cursor metadata remain correct.
- SSH/remote PTYs are not accidentally put on the local-only hidden-snapshot path.

## Reference-app findings

Checked local OSS reference repos via the `ref-oss` workflow.

High-level pattern:

- Electron/xterm-style apps generally do **not** treat hiding a terminal as
  killing the terminal object. Hidden groups/tabs keep the terminal instance
  around, toggle visibility/display, and re-open/resize on show.
- They commonly keep PTY output flowing into xterm while hidden, because that is
  the simplest way to preserve TUI state and avoid corrupted restore.
- Terminal-emulator-style apps often add flow control around xterm writes:
  xterm write callbacks become the backpressure signal, preventing unbounded
  renderer write queues.
- Agent/workspace-style notes point out that FIFO replay alone is not enough for
  TUI correctness. Important terminal modes such as bracketed paste, focus,
  mouse, cursor visibility, application cursor, and kitty keyboard protocol can
  be lost if the replay buffer evicts the early mode-setting bytes. A headless
  terminal mirror can preserve those modes, but parsing every hidden byte
  synchronously is the cost center Orca is currently hitting.

What this means for Orca:

- We should **not** reintroduce the old “unmount hidden terminals and replay a
  FIFO later” approach. That is exactly the path that causes restore delays and
  damaged TUIs.
- The safer design is a hybrid:
  - visible terminals stay live;
  - hidden local terminals avoid renderer work;
  - main/runtime preserves mode/state correctness, but with budgeting/deferred
    catch-up instead of unlimited synchronous parsing for every hidden byte.
- Orca is different from ordinary terminal apps because many hidden agent
  terminals can stream output at once, and Orca also maintains main-owned
  terminal state for restore/mobile/read APIs. That duplication is where the
  freeze appears.

## Goal-ready action items

### 1. Keep and polish the diagnostic repro

- Convert the current cross-workspace pressure probe into a committed regression
  test or an opt-in perf test.
- Keep the test focused on the real user symptom:
  - active terminal echo/liveness latency,
  - renderer memory,
  - renderer scheduler backlog,
  - main→renderer pending/in-flight chars.
- Add one extra counter for main/runtime headless backlog or hidden deferred
  bytes once that mechanism exists.

Suggested success target:

- 17 hidden/cross-workspace PTYs streaming 4MiB each should keep active terminal
  liveness under 2s, ideally under ~500ms for all probes.
- Renderer scheduler queue should stay near zero for hidden panes.
- Renderer memory should not climb toward ~1GB in this scenario.

### 2. Finish the safe renderer-side hidden output gate

- Keep the prototype direction where hidden local PTYs are not sent through the
  renderer/xterm live path.
- Make the visibility signal robust:
  - all visible split panes must be marked visible, not just the focused pane;
  - hidden workspaces/tabs must mark their local PTYs hidden;
  - pane close/PTY exit must clean up visibility state.
- Keep SSH/remote PTYs off this path until a remote-safe restore source exists.
- Ensure hidden panes get a restore-needed signal when skipped bytes arrive.
- Verify hidden panes restore from the main-owned snapshot when shown.

Suggested tests:

- Unit test main-side hidden renderer delivery suppression.
- E2E test hidden local terminal output restores when switching back.
- E2E test visible split panes still update live.
- E2E test SSH/remote PTYs are not suppressed by the local-only path.

### 3. Design non-lossy deferred headless/runtime ingestion

This is the core unresolved piece.

- Do **not** ship the lossy experiment that simply skips `runtime.onPtyData` for
  hidden PTYs.
- Add a deferred path for hidden high-volume local PTY output:
  - append hidden bytes to a cheap bounded buffer with sequence metadata;
  - keep lightweight side effects that are cheap and important, if needed
    (for example title/status tails), but avoid full headless xterm parsing on
    every hidden chunk;
  - mark the headless terminal state as dirty/stale.
- Drain/catch up the deferred buffer under controlled conditions:
  - when the pane becomes visible;
  - when a mobile/client snapshot is requested;
  - when `orca terminal read` needs data;
  - on PTY exit/final persistence;
  - opportunistically during idle time, with a strict budget.
- Preserve terminal mode/state correctness. FIFO-only replay is not enough for
  rich TUIs; modes such as bracketed paste, focus, mouse, cursor visibility,
  app cursor, and kitty keyboard protocol matter.

Open design choice:

- Either keep the headless emulator authoritative but feed it through a
  budgeted queue, or maintain a cheap raw/tail buffer while hidden and rebuild
  the headless emulator from a bounded replay when needed. The first is safer
  for mode continuity; the second may be cheaper but risks old restore bugs if
  the replay window loses mode-setting bytes.

### 4. Preserve terminal read/mobile correctness

- Audit `runtime.serializeMainTerminalBuffer`, mobile terminal snapshot paths,
  and `orca terminal read` pagination before changing headless ingestion.
- Add tests proving:
  - `orca terminal read --limit` still returns recent hidden output;
  - cursor metadata remains correct (`oldestCursor`, `nextCursor`,
    `latestCursor`, returned line count);
  - partial-line behavior is preserved;
  - truncation flags and total line counts remain correct;
  - mobile/browser clients can still hydrate terminal state.

### 5. Protect TUI restore explicitly

- Keep or extend the existing hidden TUI visual restore coverage.
- Add/verify cases for:
  - alternate screen,
  - bracketed paste,
  - cursor visibility,
  - synchronized output (`DEC 2026`),
  - terminal color-scheme query/reply behavior,
  - rich table/full-screen agent UI restore.
- Switching back to a hidden TUI should not show corrupted rows, missing cursor,
  duplicated prompts, or a long blank restore delay.

### 6. Add before/after benchmark evidence

Record the same scenario before and after the final fix:

- command used,
- pane count,
- MiB per pane,
- active liveness probe latencies,
- renderer memory,
- app total memory,
- scheduler queued/peak chars,
- main pending/in-flight chars,
- hidden deferred/backlog counters.

Expected comparison:

- Baseline: active latency can climb to multi-second; renderer queue can hit
  millions of chars; memory can approach the reported ~1GB class.
- Fixed: active terminal stays responsive; hidden output does not build renderer
  backlog; main/runtime work is bounded.

### 7. Clean up prototypes before PR

- Remove any purely diagnostic or lossy experiment code.
- Keep only production-safe visibility/restore/deferred-ingestion code.
- Decide which diagnostic E2E files should be committed and which should remain
  local investigation artifacts.
- Run at minimum:
  - focused terminal unit tests,
  - hidden TUI restore E2E,
  - cross-workspace pressure repro,
  - `pnpm run typecheck:web`,
  - relevant lint on touched files.

## Suggested `/goal` prompt

Continue the terminal freeze investigation on branch `terminal-freeze-after-renderer-memory-spike` and turn the proven findings into a production-safe fix. The user report is: after renderer memory spikes, existing terminals stop echoing input and new terminals can show only a blank cursor/prompt area. Do not solve this by unmounting hidden terminals or dropping hidden PTY output. Preserve terminal restore, TUI correctness, SSH/remote behavior, mobile/browser hydration, and `orca terminal read` correctness.

Use the existing diagnostic repros to prove the issue and the fix. The leading finding is that hidden/cross-workspace local terminals stream output through both renderer xterm work and main/runtime headless xterm parsing. Renderer-side gating reduces memory/backlog, but active terminal liveness can still fail until hidden main/runtime headless parsing is bounded. A deliberately lossy skip proved the cost center, but must not ship.

Deliver a PR-ready fix with benchmark evidence, regression tests, and a short plain-English explanation of what changed and what risk remains.

## Concrete action checklist for the next goal

### Phase A: Re-establish baseline and protect the investigation

- Run `git status --short` and separate three buckets:
  - production candidate changes,
  - diagnostic tests/helpers worth keeping,
  - throwaway experiment code that must not ship.
- Re-run the strongest repro once before changing behavior so the goal has fresh numbers from this machine.
- Save the benchmark output in this markdown file or a small dedicated benchmark note before editing the implementation further.
- Confirm there is no remaining lossy hidden-output skip before starting the real fix.

### Phase B: Make renderer-side hidden output gating production-safe

- Finalize the local-only hidden renderer suppression path.
- Ensure visibility means “actually visible on screen,” not merely “focused.” Visible split panes should keep live output.
- Ensure hidden tabs/workspaces stop receiving live renderer writes.
- Clean up visibility state on pane close, PTY exit, workspace switch, and renderer reload.
- Keep SSH/remote PTYs out of this path unless there is an explicitly verified remote-safe restore source.
- Add or update tests that prove:
  - hidden local PTY output does not build renderer scheduler backlog,
  - hidden local terminal output restores when shown again,
  - visible split terminals still update live,
  - remote/SSH terminals are not accidentally suppressed.

### Phase C: Fix the remaining main/runtime starvation without losing data

- Audit `src/main/ipc/pty.ts`, `src/main/runtime/orca-runtime.ts`, and `src/main/daemon/headless-emulator.ts` around local PTY data flow.
- Identify exactly where hidden terminal output is synchronously parsed by the headless emulator.
- Replace unlimited hidden synchronous parsing with a non-lossy bounded/budgeted path.
- The path should preserve raw output and sequence/order metadata, mark headless state dirty when needed, and catch up under controlled conditions.
- Catch-up triggers should include:
  - pane becomes visible,
  - terminal snapshot/mobile/browser hydration is requested,
  - `orca terminal read` needs hidden output,
  - PTY exits or final persistence runs,
  - idle/background budget is available.
- Avoid FIFO-only replay if it can lose TUI mode state. If replay is used, prove it preserves modes or constrain it to cases where mode loss cannot corrupt restore.

### Phase D: Verify correctness-sensitive paths

- Verify hidden terminal restore with ordinary shell output.
- Verify hidden TUI restore, especially alternate screen behavior.
- Verify cursor/mode-sensitive behavior: cursor visibility, bracketed paste, mouse/focus modes if practical, synchronized output if existing fixtures cover it.
- Verify `orca terminal read --limit` still returns recent hidden output with correct cursor metadata.
- Verify mobile/browser terminal snapshot hydration still works.
- Verify active terminal input latency stays healthy while hidden terminals are streaming.

### Phase E: Benchmark before/after and make the PR easy to review

- Capture before/after metrics for the strongest repro:
  - hidden pane count,
  - MiB per pane,
  - active liveness probe latencies,
  - renderer memory,
  - total app memory if available,
  - renderer scheduler queued/peak chars,
  - main pending/in-flight chars,
  - new hidden deferred/backlog counters if added.
- Target outcome:
  - active liveness stays below 2s, ideally below ~500ms,
  - renderer queue stays near zero for hidden panes,
  - renderer memory stays bounded and does not approach the reported ~1GB class,
  - hidden output restore remains correct.
- Clean the PR scope:
  - remove throwaway diagnostics unless they are committed as intentional perf tests,
  - remove any lossy experiment code,
  - keep comments short and focused on why hidden terminal data is budgeted/deferred,
  - do not mention private reference-app names in code, docs, or PR text.

### Minimum validation before handing back

```sh
pnpm run typecheck:web
npx playwright test tests/e2e/terminal-hidden-tui-visual-restore.spec.ts --config tests/playwright.config.ts --project electron-headful --workers=1
ORCA_E2E_TERMINAL_CROSS_WORKSPACE_PRESSURE=1 \
ORCA_E2E_TERMINAL_BACKGROUND_PANES=17 \
ORCA_E2E_TERMINAL_BACKGROUND_PRESSURE_MIB_PER_PANE=4 \
ORCA_E2E_TERMINAL_BACKGROUND_PROBES=4 \
ORCA_E2E_TERMINAL_LIVENESS_TIMEOUT_MS=10000 \
npx playwright test tests/e2e/terminal-background-pressure-liveness.spec.ts \
  --grep "another workspace" \
  --config tests/playwright.config.ts \
  --project electron-headful \
  --workers=1
```

If the final implementation changes runtime/headless ingestion, add the most focused unit tests available around terminal buffer serialization and cursor metadata rather than relying only on the large E2E repro.

## Progress update: production-safe deferred headless parsing prototype

Implemented and verified a safer version of the two-level strategy:

- Renderer delivery is suppressed only for local PTYs that the renderer explicitly reports as hidden.
  - Unknown/new PTYs default to live renderer delivery, which preserves startup and existing batching behavior.
  - Hidden panes send a `pty:rendererOutputSkipped` signal so the renderer knows its xterm state is stale and must restore from the main-owned snapshot when shown.
  - Remote/SSH PTYs are not put on this local-only hidden path.
- Runtime/headless xterm parsing is no longer unlimited inline work for explicitly hidden local PTYs.
  - Raw hidden bytes are kept in order in a deferred queue with output sequence metadata.
  - Terminal read/status/tail/subscriber paths still update from raw PTY data immediately.
  - Headless snapshots drain deferred bytes before serializing, so hidden restore/mobile snapshots still see a current main-owned xterm snapshot.
  - A small global background drain budget exists so idle catch-up cannot become one parser loop per hidden PTY.
  - The in-memory deferred queue is capped per PTY; larger hidden backlogs spill to temp files without dropping bytes.

Important correction made during validation:

- The first implementation treated PTYs as hidden until marked visible. That broke normal spawn/batching tests because renderer output was suppressed before any renderer visibility report. The current behavior is safer: output is suppressed only after an explicit `visible: false` signal.
- The first snapshot flush path accidentally widened an existing write-chain race by awaiting an already-resolved no-op flush. The current path preserves the original race semantics when there are no deferred hidden bytes.

New focused tests added:

- `src/main/runtime/orca-runtime.test.ts`
  - hidden headless parsing defers while `readTerminal` remains current;
  - `serializeMainTerminalBuffer` drains deferred bytes and returns the expected sequence.
- `src/main/ipc/pty.test.ts`
  - hidden local PTY renderer delivery is suppressed;
  - normal renderer delivery resumes when the PTY is visible again;
  - remote-owned PTYs are not suppressed by the local hidden-output path.

Validation run after this change:

```sh
pnpm vitest run src/main/ipc/pty.test.ts src/main/runtime/mobile-subscribe-integration.test.ts
pnpm run typecheck:web
git diff --check
```

Result:

- `src/main/ipc/pty.test.ts`: 157 passed
- `src/main/runtime/mobile-subscribe-integration.test.ts`: 43 passed, 2 skipped
- `pnpm run typecheck:web`: passed
- `git diff --check`: passed

Next action items:

- Cross-workspace pressure E2E has been run with the deferred-headless path and benchmark evidence is recorded below.
- Keep only the pressure E2E harness and its liveness helper as durable opt-in benchmark coverage.
- Hidden TUI visual restore E2E passed under `electron-headless`.
- Deferred headless backlog counters are exposed through the existing renderer-delivery debug snapshot and recorded by the pressure harness.
- A follow-up audit found and fixed a spool-only snapshot edge case: if the in-memory deferred queue had drained but temp-file spillover still contained hidden bytes, snapshots now still flush the spool before serializing. `src/main/runtime/orca-runtime.test.ts` covers this by draining in-memory deferred chunks first and then asserting the spooled tail appears in `serializeMainTerminalBuffer`.


## Benchmark/update: cross-workspace pressure after deferred headless parsing

Final command run after rebuilding the Electron E2E bundle:

```sh
ORCA_E2E_TERMINAL_CROSS_WORKSPACE_PRESSURE=1 \
ORCA_E2E_TERMINAL_BACKGROUND_PANES=17 \
ORCA_E2E_TERMINAL_BACKGROUND_PRESSURE_MIB_PER_PANE=4 \
ORCA_E2E_TERMINAL_BACKGROUND_PROBES=4 \
ORCA_E2E_TERMINAL_LIVENESS_TIMEOUT_MS=10000 \
npx playwright test tests/e2e/terminal-background-pressure-liveness.spec.ts \
  --grep "another workspace" \
  --config tests/playwright.config.ts \
  --project electron-headful \
  --workers=1
```

Result: passed.

Measured probes after adding the bounded in-memory deferred queue plus temp-file spillover for larger hidden backlogs. These numbers were refreshed after rebasing onto latest `origin/main` and updating the renderer hidden-restore tests:

| Probe | Active liveness | Renderer memory | Total app memory | Scheduler queued | Scheduler peak | Main pending | Main in-flight | Hidden/deferred headless |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 64.6ms | 386MiB | 867MiB | 0 | 767 chars | 0 | 0 | 17 hidden / 15 deferred / 1,114,304 chars |
| 2 | 1165.4ms | 385MiB | 925MiB | 0 | 767 chars | 0 | 0 | 17 hidden / 17 deferred / 18,593,063 chars |
| 3 | 755.4ms | 385MiB | 1016MiB | 0 | 767 chars | 0 | 0 | 17 hidden / 17 deferred / 70,312,870 chars |
| 4 | 61.1ms | 385MiB | 1017MiB | 0 | 767 chars | 0 | 0 | 17 hidden / 17 deferred / 70,191,014 chars |

Interpretation:

- This fixes the strongest user-shaped liveness failure in the repro: all probes stayed below the 2s target and classified as `terminal-layer-healthy`.
- Renderer queue pressure stayed eliminated (`schedulerQueuedChars=0`; peak only 767 chars).
- Renderer memory stayed around ~385–386MiB, much lower than the earlier ~800MiB+ class in this scenario.
- Total app memory reached ~1.0GiB in this run while renderer memory stayed bounded. This addresses the terminal liveness/render-queue side of the report; it still should not be represented as a complete explanation for every possible 1.2GB resource-manager observation.
- Hidden headless backlog is now visible in benchmark output. The in-memory queue is capped per PTY and spills larger hidden backlogs to temp files without dropping terminal bytes.

Hidden TUI restore validation:

```sh
SKIP_BUILD=1 npx playwright test tests/e2e/terminal-hidden-tui-visual-restore.spec.ts \
  --grep "restores hidden full-screen" \
  --config tests/playwright.config.ts \
  --project electron-headless \
  --workers=1
```

Result: passed.

Note: the earlier checklist used `electron-headful`, but this spec is not tagged `@headful`; the current Playwright config only includes it in the `electron-headless` project.

## Cleanup update

The PR surface now keeps the cross-workspace/background terminal pressure harness and shared liveness diagnostic helper. The one-off memory-pressure, basic liveness, and scrollback-reflow diagnostic specs were removed from the worktree because they were useful for investigation but do not directly guard the final fix.

The pressure harness records hidden/deferred headless backlog counters via `window.api.pty.getRendererDeliveryDebugSnapshot()`, so benchmark output shows both renderer queue pressure and main/runtime deferred backlog in the same output.

## Validation update after final audit

Fresh validation after fixing the spool-only snapshot edge case:

```sh
pnpm vitest run src/main/runtime/orca-runtime.test.ts src/main/ipc/pty.test.ts src/main/runtime/mobile-subscribe-integration.test.ts
pnpm run typecheck:web
git diff --check
SKIP_BUILD=1 npx playwright test tests/e2e/terminal-hidden-tui-visual-restore.spec.ts \
  --grep "restores hidden full-screen" \
  --config tests/playwright.config.ts \
  --project electron-headless \
  --workers=1
ORCA_E2E_TERMINAL_CROSS_WORKSPACE_PRESSURE=1 \
ORCA_E2E_TERMINAL_BACKGROUND_PANES=17 \
ORCA_E2E_TERMINAL_BACKGROUND_PRESSURE_MIB_PER_PANE=4 \
ORCA_E2E_TERMINAL_BACKGROUND_PROBES=4 \
ORCA_E2E_TERMINAL_LIVENESS_TIMEOUT_MS=10000 \
npx playwright test tests/e2e/terminal-background-pressure-liveness.spec.ts \
  --grep "another workspace" \
  --config tests/playwright.config.ts \
  --project electron-headful \
  --workers=1
```

Results:

- Runtime/IPC/mobile integration tests: `3 passed`, `548 passed | 2 skipped`.
- `pnpm run typecheck:web`: passed.
- `git diff --check`: passed.
- Hidden TUI restore E2E: passed.
- Cross-workspace pressure E2E: passed with the refreshed metrics above.

## Current `/goal` action items

Use this section as the starting point for a new focused goal. The code is close to PR-ready, but should be treated as a production-safety audit plus evidence pass, not as a finished merge.

### 1. Audit the final diff for correctness and scope

- Inspect every touched file and confirm the shipped behavior is non-lossy.
- Confirm hidden local PTY output still updates main-owned raw output/read/status state before any renderer/headless deferral.
- Confirm remote/SSH-owned PTYs are never suppressed by the local hidden renderer path.
- Confirm new PTYs default to live delivery until the renderer explicitly reports them hidden.
- Inspect `shouldSnapshotHiddenCodexOutput` in `src/renderer/src/components/terminal-pane/pty-connection.ts`; keep it only if it is still needed for renderer-query/startup behavior, otherwise rename/remove stale logic.
- Verify temp-file spillover cleanup runs on PTY clear/dispose/error paths and uses private file permissions where supported.

### 2. Re-run the focused validation suite

Run these before considering the PR ready:

```sh
pnpm vitest run src/main/runtime/orca-runtime.test.ts src/main/ipc/pty.test.ts src/main/runtime/mobile-subscribe-integration.test.ts
pnpm run typecheck:web
git diff --check
SKIP_BUILD=1 npx playwright test tests/e2e/terminal-hidden-tui-visual-restore.spec.ts \
  --grep "restores hidden full-screen" \
  --config tests/playwright.config.ts \
  --project electron-headless \
  --workers=1
ORCA_E2E_TERMINAL_CROSS_WORKSPACE_PRESSURE=1 \
ORCA_E2E_TERMINAL_BACKGROUND_PANES=17 \
ORCA_E2E_TERMINAL_BACKGROUND_PRESSURE_MIB_PER_PANE=4 \
ORCA_E2E_TERMINAL_BACKGROUND_PROBES=4 \
ORCA_E2E_TERMINAL_LIVENESS_TIMEOUT_MS=10000 \
npx playwright test tests/e2e/terminal-background-pressure-liveness.spec.ts \
  --grep "another workspace" \
  --config tests/playwright.config.ts \
  --project electron-headful \
  --workers=1
```

### 3. Decide what diagnostic coverage belongs in the PR

- Keep `tests/e2e/helpers/terminal-liveness-diagnostics.ts` if the pressure spec remains committed.
- Keep `tests/e2e/terminal-background-pressure-liveness.spec.ts` as an opt-in benchmark/regression harness if reviewers are comfortable with the runtime.
- Do not re-add the one-off memory-pressure, basic liveness, or scrollback-reflow investigation specs unless they directly guard the final behavior.
- Make sure committed tests are deterministic enough for local/CI use, or clearly env-gated as perf diagnostics.

### 4. Prepare an honest PR description

The PR should claim:

- Hidden local terminals no longer keep doing unlimited live renderer/xterm work while off-screen.
- Hidden local headless parsing is deferred/budgeted instead of synchronously parsing every hidden byte inline.
- Raw output is still retained; snapshots/read/mobile restore paths catch up before they need current terminal state.
- The strongest repro stays responsive under 17 hidden streaming PTYs.

The PR should **not** claim:

- This fully explains every possible 1.2GB renderer/resource-manager memory report.
- This fixes all terminal freezes in Orca.
- Hidden terminals are unmounted or output is dropped.

### 5. Include benchmark evidence in the PR body

Use the final benchmark table already recorded above, especially:

- active liveness: `64.6ms`, `1165.4ms`, `755.4ms`, `61.1ms`;
- renderer memory: `386MiB`, `385MiB`, `385MiB`, `385MiB`;
- scheduler queued chars: `0` on every probe;
- hidden/deferred headless backlog reaching `70,312,870` chars without dropping bytes;
- hidden TUI restore E2E passed under `electron-headless`.

Frame this as a fix for the terminal liveness/render-queue starvation path, with bounded memory/backlog behavior, not as the complete postmortem for all reported memory spikes.

### 6. Plain-English final explanation to preserve

The likely bug was not that the visible terminal itself broke. Orca was letting many hidden terminals keep doing expensive live terminal-rendering work in the background. That work built up enough renderer and main-process terminal parsing pressure that the active terminal could not echo input quickly, so it looked frozen. The fix keeps hidden terminal output safe and restorable, but stops treating off-screen local terminals like they need full live rendering every moment.

## Normalized terminal tail cap benchmark: 256KB vs 64KB

This benchmark isolates Orca's main-owned normalized text tail (`appendNormalizedToTailBuffer`) and compares a 256KB retained tail with a hypothetical 64KB retained tail as terminal count scales. It does **not** measure xterm/headless parsing, renderer painting, WebGL, or human scrollback. It is specifically about the retained text buffer used by programmatic reads/previews/waits/status.

Command run:

```sh
node --expose-gc .tmp/terminal-tail-cap-benchmark.js > .tmp/terminal-tail-cap-benchmark.json
```

Setup:

- Standalone copy of the current tail-retention algorithm, parameterized by byte cap.
- 512KB of normalized output per simulated terminal, chunked into 16KB writes.
- Median of 5 runs for 1/10/50/100 terminals, 3 runs for 250 terminals, and 2 runs for 500 terminals.
- Existing caps preserved in the benchmark: 2,000 completed lines and 4KB partial line.

### Wide log lines: 200-char completed lines, byte cap dominates

| Terminals | 64KB median | 256KB median | 64KB retained | 256KB retained | CPU delta | Retained delta |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 0.75ms | 0.78ms | 63.9KiB | 255.9KiB | -4.5% | -75.0% |
| 10 | 6.43ms | 7.70ms | 638.7KiB | 2,558.6KiB | -16.5% | -75.0% |
| 50 | 29.00ms | 30.86ms | 3,193.4KiB | 12,793.0KiB | -6.0% | -75.0% |
| 100 | 53.47ms | 62.01ms | 6,386.7KiB | 25,585.9KiB | -13.8% | -75.0% |
| 250 | 138.06ms | 178.95ms | 15,966.8KiB | 63,964.8KiB | -22.8% | -75.0% |
| 500 | 284.94ms | 339.91ms | 31,933.6KiB | 127,929.7KiB | -16.2% | -75.0% |

### Short shell-ish lines: 80-char completed lines, line cap competes with byte cap

| Terminals | 64KB median | 256KB median | 64KB retained | 256KB retained | CPU delta | Retained delta |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 0.83ms | 1.30ms | 64.0KiB | 156.3KiB | -36.4% | -59.1% |
| 10 | 8.66ms | 8.29ms | 639.8KiB | 1,562.5KiB | +4.5% | -59.1% |
| 50 | 40.82ms | 49.08ms | 3,199.2KiB | 7,812.5KiB | -16.8% | -59.1% |
| 100 | 85.36ms | 99.13ms | 6,398.4KiB | 15,625.0KiB | -13.9% | -59.1% |
| 250 | 238.27ms | 263.70ms | 15,996.1KiB | 39,062.5KiB | -9.6% | -59.1% |
| 500 | 473.68ms | 588.96ms | 31,992.2KiB | 78,125.0KiB | -19.6% | -59.1% |

### Newline-free TUI redraws: CR/ANSI redraw stream, partial-line cap dominates

| Terminals | 64KB median | 256KB median | 64KB retained | 256KB retained | CPU delta | Retained delta |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 0.91ms | 0.87ms | 0.2KiB | 0.2KiB | +4.1% | 0.0% |
| 10 | 8.22ms | 8.23ms | 2.0KiB | 2.0KiB | -0.2% | 0.0% |
| 50 | 39.39ms | 39.83ms | 10.0KiB | 10.0KiB | -1.1% | 0.0% |
| 100 | 79.23ms | 79.48ms | 19.9KiB | 19.9KiB | -0.3% | 0.0% |
| 250 | 199.50ms | 199.90ms | 49.8KiB | 49.8KiB | -0.2% | 0.0% |
| 500 | 407.20ms | 399.42ms | 99.6KiB | 99.6KiB | +1.9% | 0.0% |

Takeaways:

- Lowering the normalized tail from 256KB to 64KB saves up to about 192KB per terminal in this layer, or about 94MiB at 500 terminals when the byte cap is the limiter.
- For short shell-like output, the 2,000-line cap already prevents reaching 256KB, so the practical saving is closer to 92KB per terminal in this benchmark.
- For newline-free TUI redraw streams, the 4KB partial-line cap already dominates, so 64KB vs 256KB makes no meaningful difference.
- CPU scales roughly linearly with terminal count. In completed-line workloads, the 64KB cap was usually about 10-20% faster at larger terminal counts because each append scans/trims fewer retained line characters. That is helpful but not the main terminal-freeze fix; the larger win remains suppressing/defering hidden renderer/headless terminal work.

## Hidden restore visual side-effect harness: 1,000 hidden lines

Added a focused Playwright harness in `tests/e2e/terminal-hidden-restore-no-catchup-scroll.spec.ts` to answer whether a hidden terminal visibly scrolls/replays when it is refocused after a large hidden burst.

Harness shape:

- Open a terminal in a secondary worktree.
- Seed visible baseline content before hiding the terminal.
- Switch to another worktree so the terminal is hidden.
- Write 1,000 lines to the hidden PTY from a script.
- Wait for the script completion file from the test process, avoiding a pre-focus main-buffer snapshot that would make the restore path easier than reality.
- Assert the hidden burst exercised deferred headless restore (`deferredHeadlessChars > 20,000`).
- Start a `requestAnimationFrame` recorder before switching back.
- Record each visible terminal frame: whether the pane is actually DOM-visible, whether the old baseline is present, whether the final hidden line is present, the latest hidden line number seen, serialized text length, `baseY`, and `viewportY`.

Current result on `electron-headless`:

```sh
SKIP_BUILD=1 npx playwright test tests/e2e/terminal-hidden-restore-no-catchup-scroll.spec.ts \
  --config tests/playwright.config.ts \
  --project electron-headless \
  --workers=1
```

Result: the strict “first visible frame is already fully caught up” assertion currently fails.

Observed frame sequence after returning to the hidden terminal:

- Frames 0–1: terminal pane is DOM-visible, but still shows the old baseline content; no hidden burst lines are visible yet.
- Frame 2 onward: final restored state is present immediately, with line 1,000 visible in the serialized buffer and stable `baseY`/`viewportY` values.
- No sampled frame showed intermediate catch-up line numbers such as 200 → 500 → 1,000. In this harness, the restore does **not** visibly scroll through the 1,000 hidden lines; it swaps from stale content to the final restored state after roughly 1–2 animation frames.

Interpretation:

- The current PR does not appear to cause line-by-line catch-up scrolling for a 1,000-line hidden burst.
- It does appear to have a small visible stale-frame artifact on refocus: for about 1–2 frames, the user can see the pre-hidden terminal contents before the main-owned snapshot replay finishes.
- This is less severe than “watching 1,000 lines replay,” but it is a real visual side effect if the bar is “first visible frame must already be current.”

Follow-up options:

1. Keep the PR as-is and document the tradeoff honestly: no visible catch-up scroll, but possible brief stale frame on refocus.
2. Make the harness a failing/manual regression guard for a follow-up polish PR that eliminates the stale frame.
3. Explore a pre-restore path before a hidden terminal becomes visible. The risk is reintroducing a restore delay or hidden renderer work; any fix should preserve the current no-loss, no-hidden-live-rendering behavior.

### Follow-up result: blank stale renderer copy before restore

Implemented a small renderer-side polish in `src/renderer/src/components/terminal-pane/pty-connection.ts`:

- When hidden output is skipped, clear the stale renderer xterm copy once with `CSI 2J / CSI 3J / cursor home`.
- Keep the main-owned terminal snapshot as the authoritative state.
- Reset the blanking flag after the real snapshot is replayed.

This changes the visible refocus behavior from:

1. old/stale terminal content for ~1–2 frames;
2. final restored terminal state;

into:

1. blank/minimal terminal surface for ~1–2 frames;
2. final restored terminal state.

Validation:

```sh
npx playwright test tests/e2e/terminal-hidden-restore-no-catchup-scroll.spec.ts \
  --config tests/playwright.config.ts \
  --project electron-headless \
  --workers=1

SKIP_BUILD=1 npx playwright test tests/e2e/terminal-hidden-restore-no-catchup-scroll.spec.ts \
  --config tests/playwright.config.ts \
  --project electron-headless \
  --workers=1
```

Result after the change: passed.

Observed sample behavior after rebuild:

- Pre-restore visible frames contained only a tiny clear/reset remnant (`textLength ~= 8`, preview `ESC [?2004h`), not the old baseline terminal contents.
- No sampled frame showed intermediate hidden line numbers.
- Once restored, every later sampled frame had the final hidden line 1,000 and stable viewport state.

Timed follow-up on 2026-06-16:

- Added `performance.now()` timestamps to the hidden restore frame recorder.
- Reran the focused harness with `SKIP_BUILD=1` after the renderer blanking change.
- Result: passed.
- Visible samples before restore: 2 blank/minimal frames.
- First visible blank frame → first fully restored frame: `30.9ms`.
- Last blank frame → first fully restored frame: `19.5ms`.
- First restored sample was frame index 2; every later sample stayed fully restored with line 1,000 present.

Interpretation: in this run it was actually 1–2 visible rAF samples / ~31ms, not several dozen frames.

## PR prep validation after rebasing latest main

Commands run on 2026-06-16 after the final renderer test update:

```sh
pnpm exec vitest run --config config/vitest.config.ts src/renderer/src/components/terminal-pane/pty-connection.test.ts
pnpm vitest run src/main/runtime/orca-runtime.test.ts src/main/ipc/pty.test.ts src/main/runtime/mobile-subscribe-integration.test.ts
pnpm run typecheck:web
git diff --check
SKIP_BUILD=1 npx playwright test tests/e2e/terminal-hidden-restore-no-catchup-scroll.spec.ts \
  --config tests/playwright.config.ts \
  --project electron-headless \
  --workers=1
SKIP_BUILD=1 npx playwright test tests/e2e/terminal-hidden-tui-visual-restore.spec.ts \
  --grep "restores hidden full-screen" \
  --config tests/playwright.config.ts \
  --project electron-headless \
  --workers=1
SKIP_BUILD=1 ORCA_E2E_TERMINAL_CROSS_WORKSPACE_PRESSURE=1 \
  ORCA_E2E_TERMINAL_BACKGROUND_PANES=17 \
  ORCA_E2E_TERMINAL_BACKGROUND_PRESSURE_MIB_PER_PANE=4 \
  ORCA_E2E_TERMINAL_BACKGROUND_PROBES=4 \
  ORCA_E2E_TERMINAL_LIVENESS_TIMEOUT_MS=10000 \
  npx playwright test tests/e2e/terminal-background-pressure-liveness.spec.ts \
    --grep "another workspace" \
    --config tests/playwright.config.ts \
    --project electron-headful \
    --workers=1
```

Results:

- Renderer PTY connection tests: `161 passed`.
- Main/runtime/mobile tests: `564 passed | 2 skipped`.
- `pnpm run typecheck:web`: passed after refreshing the local frozen install for declared dependencies.
- `git diff --check`: passed.
- Hidden no-catchup-scroll E2E: passed.
- Hidden TUI restore E2E: passed.
- Cross-workspace pressure E2E: passed with the refreshed metrics above.

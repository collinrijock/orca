# Linux Sogou Pinyin Terminal IME Diagnosis

Date: 2026-07-06

## Scope

This note diagnoses [#7543](https://github.com/stablyai/orca/issues/7543), where
Ubuntu 22.04 users cannot reliably enter Chinese text with Sogou Pinyin in
Orca's integrated terminal.

The report is a newer instance of the same Linux/Sogou class described in
[#6765](https://github.com/stablyai/orca/issues/6765):

- Orca terminal only; English input works.
- Sogou Pinyin on Linux fails, while other native surfaces are expected to work.
- Candidate selection via Space or digits leaks the selection key or drops the
  committed CJK text.
- Multi-character words/phrases are the most broken path.

## User-Visible Shape

#7543 reports two agent TUIs:

- Claude Code: one-character input sometimes works when the first candidate is
  selected with Space. Selecting another candidate with a number inserts only
  the number. Word/phrase input does not commit Chinese text.
- Codex: one-character input leaks Space or number; word/phrase input commits
  nothing.

That difference is expected from Orca's terminal input stack. Codex enables
Kitty keyboard progressive enhancement; Claude Code does not. Orca's key handler
comment in `use-terminal-pane-lifecycle.ts` explicitly calls out this split.
When a candidate key leaks, Codex is more likely to turn it into a visible
terminal input artifact.

## Relevant Input Stack

The live path is:

1. Chromium focuses xterm's hidden `.xterm-helper-textarea`.
2. Linux IME emits `composition*`, `keydown`, `keyup`, and `input` events on
   that helper textarea.
3. Orca's `attachCustomKeyEventHandler` runs before xterm's normal key logic.
4. xterm's `CompositionHelper` reads or diffs the helper textarea and emits
   committed text through `terminal.onData`.
5. `connectPanePty` forwards `onData` bytes to the PTY.

The important ordering is in xterm:

- `CoreBrowserTerminal._keyDown` exits immediately if Orca's custom handler
  returns `false`.
- `CompositionHelper.keydown()` has special logic for `keyCode === 229`. When
  not actively composing, that branch calls `_handleAnyTextareaChanges()` so a
  following native textarea commit can be diffed and sent to the PTY.
- If Orca suppresses that keydown before xterm sees it, xterm never schedules
  the textarea diff.
- `CompositionHelper` matches on `keyCode === 229` only. A `key === 'Process'`
  event with a different `keyCode` never schedules the diff.
- xterm's `compositionstart`/`compositionupdate`/`compositionend` listeners do
  not go through the custom key handler. A commit that ends in a real
  `compositionend` is sent by `_finalizeComposition` regardless of keydown
  suppression.
- xterm's `_inputEvent` forwards `insertText` only when no keydown is in
  flight (`_keyDownSeen` is set on every keydown, before the custom handler
  runs), so a keydown-preceded `insertText` commit is silently dropped.
- Returning `false` from `attachCustomKeyEventHandler` does not
  `preventDefault()`. A printable suppressed keydown still fires a native
  `keypress`, and `_keyPress` forwards the character to the PTY. Before this
  fix, `shouldSuppressTerminalImeKeyboardEvent` did not inspect keypress events.

Relevant code:

- `src/renderer/src/components/terminal-pane/use-terminal-pane-lifecycle.ts`
  installs the IME tracker, native-text forwarder, and xterm custom key handler.
- `src/renderer/src/components/terminal-pane/xterm-bypass-policy.ts` decides
  whether IME-like key events bypass xterm.
- `src/renderer/src/components/terminal-pane/terminal-ime-composition-tracker.ts`
  tracks whether Orca thinks an IME composition is active.
- `node_modules/@xterm/xterm/src/browser/input/CompositionHelper.ts` owns the
  canonical xterm composition behavior.

## Prior Platform Lessons

The proposed Linux fix is intentionally modeled on the existing macOS and
Windows terminal IME work, but it should not copy either path wholesale.

The strongest precedent is macOS. #7102 changed the terminal policy so a bare
macOS `keyCode === 229` keydown can reach xterm's `CompositionHelper`; otherwise
the first key after an IME input-source switch is swallowed. Linux/Sogou appears
to need the same shape for standalone `229` / `Process` commit-trigger
keydowns: let xterm observe the non-printing keydown so it can schedule its
textarea diff, then suppress the companion release event if needed.

The Windows path is useful as an event-family warning and test precedent. The
existing Chinese IME E2E sends Windows-style `Process` / `229` events to prove
that preedit keys do not leak into the TUI. For Linux/Sogou, the likely problem
is that the same broad non-Mac suppression also blocks xterm from seeing the
commit-trigger keydown. The fix should therefore split preedit/control
suppression from standalone commit-trigger handling.

The macOS native-text forwarder is a boundary lesson, not the first fix to
port. It was built for CJK punctuation, Vietnamese replacements, and synthetic
Unicode text that commit through plain `insertText`. Linux/Sogou phrase commit
should first be repaired through xterm's composition path unless real traces
show no reliable composition or `229` hook.

## Working Diagnosis

The bug is not in Claude Code, Codex, the shell, or PTY UTF-8 transport. It is
at Orca's renderer-side terminal key boundary.

There are likely two cooperating failures.

### 1. Linux `229` / `Process` keydowns are swallowed too early

`shouldSuppressTerminalImeKeyboardEvent` currently suppresses non-Mac
`keyCode === 229` keydowns:

```ts
event.keyCode === 229 && (event.type !== 'keydown' || compositionActive || !isMac)
```

For macOS, #7102 intentionally lets a standalone `229` keydown reach xterm so
`CompositionHelper` can diff the helper textarea. Linux still takes the old
suppression path.

That is suspicious for Sogou because candidate commits often look like
`Process` / `229` key events around native textarea changes. Suppressing the
keydown protects against raw preedit keys leaking to the shell, but it also
prevents xterm from running its no-output `229` handling. The result is exactly
the reported shape: the IME commits text into the textarea, but no committed CJK
bytes reach the PTY.

Scope caveat: this mechanism only explains dropped text when the commit
happens outside a browser composition session. A commit that ends in a real
`compositionend` is sent by xterm's own composition listeners no matter what
Orca suppressed. #6765's trace table (`compositionupdate` "often empty / not
fired") supports the sessionless shape, but if real traces show a normal
`compositionstart` → `compositionend` cycle, Step 2 fixes nothing and the drop
is in `_inputEvent`'s `_keyDownSeen` guard instead (see Step 4).

### 2. Sogou can make Orca mark composition inactive before candidate commit

`terminal-ime-composition-tracker.ts` currently does this:

```ts
const updateComposition = (event: Event): void => {
  active = !(event instanceof CompositionEvent) || event.data !== ''
}
```

#6765 reports that Sogou/fcitx can emit empty `compositionupdate` data while its
candidate popup is still active. In that event shape, Orca flips
`compositionActive` to `false` before the user selects a candidate.

Once that happens, candidate keys such as Space and digits are treated as normal
terminal input. They can leak to the TUI, and under Kitty keyboard protocol they
can leave visible artifacts or release sequences.

## Fix Direction

Do not fix this in the agent CLIs. Fix the terminal IME boundary.

### Step 1: Keep Sogou-style empty updates active

Change `terminal-ime-composition-tracker.ts` so an empty `compositionupdate`
does not deactivate composition. `compositionend`, non-composition `input`, and
`blur` should own deactivation.

Suggested behavior:

```ts
const updateComposition = (event: Event): void => {
  if (event instanceof CompositionEvent && event.data !== '') {
    active = true
  }
}
```

Add unit coverage for:

- `compositionstart` then empty `compositionupdate` keeps `isActive()` true.
- `compositionend` clears it.
- non-composition `input` still clears it.

### Step 2: Let standalone `229` keydowns reach xterm on Linux too

Update `shouldSuppressTerminalImeKeyboardEvent` so Linux `keydown` events with
`keyCode === 229` are not suppressed. xterm's `CompositionHelper.keydown()`
already treats `229` as non-printing and either continues composition or
schedules textarea diffing.

Gate the change to Linux, not "non-Mac". Non-Mac also covers Windows, and
letting Windows `229` keydowns through reopens the preedit-diff race the
current suppression protects against: a Windows IME that writes preedit into
the textarea before `compositionstart` fires would get flushed to the PTY by
`_handleAnyTextareaChanges`. Widen to Windows only with its own IME
verification. This requires the policy options to carry a Linux/Windows
distinction instead of just `isMac`.

Two shape caveats:

- Pass-through is byte-safe, and more strongly than the key name suggests:
  `CompositionHelper.keydown()` swallows every `keyCode === 229` keydown
  before either encoder runs (Linux never takes the Mac-only
  `shouldIgnoreComposition` skip), so even a `229` keydown carrying a
  single-character `key` cannot emit bytes. As a second layer, a `Process`
  key maps to no sequence in either encoder: the legacy encoder switches on
  `keyCode` (229 matches no mapping) and the Kitty encoder returns no key
  code for the multi-character `'Process'` key name.
- `CompositionHelper` keys off `keyCode === 229` only. A `key === 'Process'`
  event with a different `keyCode` (a shape #6765 claims Linux Chromium can
  emit) schedules no textarea diff, so passing it through fixes nothing for
  that shape — the commit arrives as `insertText` that `_inputEvent` drops,
  and the answer is Step 4, not this step. Traces must record `keyCode` to
  tell these shapes apart.

Keep suppressing companion keyups so Kitty release reporting cannot leak.

The intended rule is:

- Linux `keydown 229` while the tracker is inactive: let xterm see it — the
  same `compositionActive` gate macOS uses (implementation: the existing
  `!isMac` term becomes Windows-only). While the tracker is active, a real
  session owns delivery via `compositionend`, and passing the keydown would be
  a no-op anyway (xterm's composing branch swallows `229` without scheduling a
  diff), so keep suppressing it for symmetry with macOS.
- `keyup 229` / `keyup Process`: suppress.
- editing keys while composition is active: suppress.
- ordinary non-IME text keys: keep existing behavior.

This splits the existing "suppresses Windows IME Process keys" expectation in
`xterm-bypass-policy-non-mac.test.ts` into a Linux case (pass) and a Windows
case (still suppressed) — do not just flip it.

### Step 3: Treat Sogou candidate-selection keys as IME-owned

Extend the active-composition suppression set to include candidate commit keys:

- Space (`' '`)
- digits (`'0'` through `'9'`)

Keydown/keyup suppression alone does not stop this leak. #7543's Claude Code
digit symptom (only the number appears) proves the candidate key arrives as a
plain key event — a suppressed `229` keydown cannot print a digit. Because the
custom handler's `false` return does not `preventDefault()`, a plain suppressed
keydown still fires a native `keypress`, and xterm's `_keyPress` forwards the
character to the PTY. The suppression branch must therefore call
`preventDefault()` on the candidate keydown, or also suppress the matching
`keypress`. If suppressing keypress, keep it scoped to candidate keys during
the guard window: committed text legitimately arrives via keypress on other
paths (see the existing keypress test in `xterm-bypass-policy-non-mac.test.ts`).

This should only apply while the composition tracker is active, plus a short
post-composition guard. #6765's trace shows the plain Space arriving after
`compositionend` — sometimes as keydown, not only keyup — when the tracker is
already correctly inactive, so the guard must absorb both the press and the
release of the key that just committed a candidate.

That guard should be narrow and timed. The purpose is to absorb the committing
key's trailing events, not to make Space or numbers globally unavailable after
IME use.

### Step 4: Do not broaden the macOS native-text forwarder unless traces prove it

`installTerminalImeNativeTextForwarder` is currently Mac-gated because it was
built for macOS CJK punctuation, Vietnamese replacements, and synthetic Unicode
text. Linux/Sogou phrase commit should primarily flow through xterm's
composition path.

Only make the forwarder platform-neutral if Linux event logs show a plain
`insertText` commit with no reliable composition event and no usable xterm
`229` hook. The `key === 'Process'` / `keyCode !== 229` shape from #6765 lands
here: xterm schedules no diff for it and `_inputEvent` drops the
keydown-preceded `insertText` commit, so the forwarder is the only remaining
delivery path. The #7543 digit shape can land here too: if Sogou forwards the
digit as a plain keydown and then commits the candidate through the input
context, that commit arrives as a keydown-preceded `insertText` and is
dropped by the same guard — so treat the digit trace as evidence for this
shape, not only as a leak. If the forwarder is needed, gate it by observed
event shape, not by a broad "Linux IME" switch.

One residual shape none of Steps 1–4 can fix: the trace may show the digit
keydown with no committed text arriving on any DOM channel (no composition
event, no `insertText`, no textarea mutation). That means fcitx/Sogou never
committed — the failure is upstream of the renderer key boundary, in the
Chromium/fcitx input-context layer, and diagnosis must move there (textarea
geometry/focus, IM context resets) instead of DOM event routing.

## Verification Plan

### Deterministic unit tests

Add or update focused tests:

- `terminal-ime-composition-tracker.test.ts` (new file)
  - empty Sogou-style `compositionupdate` keeps composition active.
- `xterm-bypass-policy-non-mac.test.ts`
  - standalone Linux `keydown 229` is not suppressed.
  - Windows `keydown Process` / `keydown 229` stays suppressed (split the
    existing "suppresses Windows IME Process keys" case per platform).
  - non-Mac `keyup Process` / `keyup 229` is suppressed.
  - Space and digit candidate keydowns and keyups are suppressed while
    composition is active, and the suppression path stops the follow-on
    keypress (via `preventDefault` or keypress suppression).
  - the post-`compositionend` guard absorbs both keydown and keyup of the
    committing key, and expires. (Feed guard state in via the options object —
    keep `shouldSuppressTerminalImeKeyboardEvent` pure like `compositionActive`
    is today.)
  - ordinary letters remain unsuppressed when only the tracker is active.

### Deterministic Electron harness

Extend `tests/e2e/chinese-ime-chat-input-repro.spec.ts` with a Sogou-like trace:

1. Focus the xterm helper textarea.
2. Emit `compositionstart`.
3. Emit one or more empty `compositionupdate` events.
4. Dispatch candidate selection via Space and digit — as plain key events
   (real `key`/`keyCode`, `isComposing=false`), not as `Process`/`229`, since
   that is the shape #7543's digit leak proves. Let the natural keypress fire
   (CDP: `Input.dispatchKeyEvent` with `type: 'keyDown'` and `text` set —
   `rawKeyDown` generates no keypress).
5. Commit `你` and `你好` through the browser IME/text pipeline. For the
   digit shape, dispatch the commit (`Input.insertText`) between the digit
   `keyDown` and `keyUp` so `_keyDownSeen` is still set — an `insertText`
   dispatched after `keyUp` flows through `_inputEvent` even on the unfixed
   build, so that ordering proves nothing about the drop.
6. Assert the PTY-backed harness receives the Chinese text and does not receive
   literal Space or digit candidate keys.
7. Keep the existing Windows-style `Process`/`229` assertions passing; Step 2
   must not change Windows behavior.

CDP cannot perfectly emulate Sogou/fcitx, so the E2E should be treated as a
contract for Orca's event routing, not a replacement for a real Linux soak.

### Real Linux/Sogou check

On Ubuntu 22.04 with Sogou Pinyin:

1. Run Orca from a build containing the fix.
2. Open a regular terminal and run a raw echo harness such as:
   `node -e "process.stdin.setRawMode(true);process.stdin.on('data',d=>{if(d[0]===3)process.exit();console.log([...d])})"`
   (the byte-3 check restores Ctrl+C exit, which raw mode disables).
3. Before judging pass/fail, capture one DOM event trace on the helper
   textarea (`type`, `key`, `keyCode`, `isComposing`, `data`, `inputType`) per
   scenario. The trace decides which fix path applies: whether commits ride a
   composition session (diagnosis 1's precondition), whether candidate keys
   arrive plain or as `Process`/`229`, and whether `keyCode` is actually 229.
4. Type one character and select with Space.
5. Type one character and select with a non-first candidate digit.
6. Type a phrase such as `nihao` and commit with Space.
7. Repeat inside Claude Code and Codex.

Pass criteria:

- The PTY receives UTF-8 bytes for the committed Chinese text.
- Space/digit candidate selectors do not arrive as standalone prompt input.
- Phrase commit works.
- English input and terminal shortcuts still work.

## Current Evidence

Focused tests on this branch now cover the Linux/Sogou candidate-key policy and
the existing native-text/input-source/paste contracts:

```sh
pnpm exec vitest run --config config/vitest.config.ts \
  src/renderer/src/components/terminal-pane/terminal-ime-native-text-forwarder.test.ts \
  src/renderer/src/components/terminal-pane/terminal-ime-input-source.test.ts \
  src/renderer/src/components/terminal-pane/terminal-paste-runtime.test.ts \
  src/renderer/src/components/terminal-pane/terminal-ime-composition-tracker.test.ts \
  src/renderer/src/components/terminal-pane/terminal-ime-candidate-key-release-guard.test.ts \
  src/renderer/src/components/terminal-pane/xterm-bypass-policy-non-mac.test.ts \
  src/renderer/src/components/terminal-pane/xterm-bypass-policy.test.ts
```

Result on 2026-07-07: 7 files passed, 141 tests passed.

The Electron/CDP live-PTY repro also passes:

```sh
pnpm run test:e2e -- tests/e2e/chinese-ime-chat-input-repro.spec.ts
```

Result on 2026-07-07: 2 tests passed, 1 real-Codex IME test skipped behind
`ORCA_E2E_REAL_CODEX_IME`.

This proves Orca's event routing for the Sogou-style Space/digit selector class,
but it is not a replacement for real Ubuntu 22.04 + Sogou Pinyin soak evidence.

## Risk Notes

- Do not suppress all text while `compositionActive` is true. Some engines can
  leave tracker state stale; broad suppression would break ordinary typing.
- Step 3's `preventDefault()` on candidate keys removes the tracker's natural
  unstick path: a suppressed Space/digit fires no `input` event, so a stale
  tracker stays stale until a letter, blur, or new composition clears it. Give
  the candidate-key suppression (or the tracker itself) a timed expiry so
  Space and digits cannot stay dead indefinitely after a missed
  `compositionend`.
- Do not let Space/digit keyups leak after a swallowed candidate keydown under
  Kitty keyboard protocol.
- Keep the `229` keydown pass-through Linux-gated. Windows preedit behavior is
  only proven safe under the current suppression; widening needs its own
  Windows IME verification.
- Suppressing a candidate keydown without `preventDefault()` (or matching
  keypress suppression) trades the keydown leak for a keypress leak; the unit
  tests must pin the keypress path, not just keydown/keyup.
- Keep the fix in renderer input routing. PTY, daemon, SSH, and remote runtime
  transport should not need UTF-8 changes for this issue.
- The SSH use case should be unaffected because the fix changes browser-to-xterm
  committed text forwarding before bytes enter any local or remote PTY
  transport.

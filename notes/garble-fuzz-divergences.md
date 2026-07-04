# Garble differential fuzz — divergence log

Findings from the HeadlessEmulator-vs-renderer-twin differential fuzz
(`src/main/daemon/headless-emulator-fidelity.fuzz.test.ts`). Each divergence is
a case where restoring a hidden terminal from its main-side snapshot
(`serialize → replay`, exactly as `applyMainBufferSnapshot` does on reveal)
produces a screen that differs from an always-visible renderer terminal fed the
same bytes. Any such diff is a user-visible garble on reveal.

## Method

- Corpus: seeded agent-TUI byte streams (`buildAgentTuiStreamOps`), 3 pane
  sizes, PTY-style random chunk splitting.
- Differential: production `HeadlessEmulator` snapshot replayed into a fresh
  renderer-parity terminal, compared cell-by-cell (text, per-cell style,
  cursor, modes, scrollback) against an always-visible renderer-parity twin.
- Parity confirmed: `createRendererParityTerminal` mirrors the renderer pane's
  buffer-affecting options exactly — `scrollback: 5000`, `allowProposedApi`,
  `vtExtensions.kittyKeyboard`, `Unicode11Addon`, Orca ZWJ provider (verified
  against `buildDefaultTerminalOptions` in
  `src/renderer/src/lib/pane-manager/pane-terminal-options.ts` and
  `pane-dom-creation.ts`). Render-only options (`minimumContrastRatio`,
  `drawBoldTextInBrightColors`, font, cursor, scrollbar) do not alter stored
  cell attributes, so their omission is not a source of false diffs.
  `windowsMode` is unset in both (matches renderer). Addon versions:
  `@xterm/addon-serialize` / `@xterm/headless` / `@xterm/addon-unicode11` all
  `*-beta.287` (headless `6.1.0-beta.287`).
- Scan: seeds 1..2000. Every divergence is either the known serialize-wrap bug
  (predicate `bufferHasSerializeHostileWrappedRow`, tolerated + counted) or is
  listed below.

## Inventory

| bug | found by | seeds | classification |
| --- | --- | --- | --- |
| A — serialize wrap null-cell | fidelity (suite 1) | 31, 157, 171, 207, 423, 426, 502, 801, 815, 826, 865, 881, 923, 977, 1004, 1119, 1142, 1238, 1241, 1318, 1351, 1374, 1532, 1601, 1657, 1728, 1770 (27 in 1..2000) | (a) real serialize bug, pre-documented + pinned |
| B — SGR bold loss (`1;22`) | fidelity (suite 1) | 435, 770, 1321 | (a) real serialize bug — garbles style on reveal |
| C — cursor off-by-one at right margin | fidelity (suite 1) | 454, 1696 | (a) real serialize bug — misplaces cursor on reveal |
| D — DECSC saved-cursor lost across reveal | reconciliation (suite 2) | seed 3 | (a) real snapshot limitation — garbles a DECRC-in-tail reveal |
| E — snapshot boundary mid-escape-sequence | reconciliation (suite 2) | seed 4 (+~24% of corpus) | (a) real snapshot limitation — continuation renders literal |

The suite-1 default corpus runs seeds 1..300, so it only hits Bug A in range
(31, 157, 171, 207) — all tolerated — which is why it passes green. All five
bug *classes* are reproduced by dedicated minimal `test.skip` repros so they
cannot silently regress. `FUZZ_ITERATIONS=2000` (or higher) surfaces Bugs B and
C as live corpus divergences; because they lack a cheap buffer-state predicate
(unlike Bug A's wrap predicate) they are pinned as standalone skipped repros and
kept out of range by the default 300 corpus. See "Corpus vs deep mode" below.

Seed 113 (called out in the handoff as a "DECSC/DECRC detour writing colored
text mid-line") does not diverge on the current harness. It is a `savedCursor
Detour` op seed; DECSC/DECRC SGR carry is correctly preserved by both the
emulator and the serializer here. It was most likely an earlier observation
folded into Bug C (the DECRC cases 1696 also involve `\x1b7`/`\x1b8`), or a
transient during harness construction. No live divergence at 113.

---

## Bug A — SerializeAddon drops null cells at a soft-wrap boundary

**Classification: (a) real `@xterm/addon-serialize` bug.** Pre-existing; found
and minimized by the prior agent, pinned by two `test.skip` repros in the fuzz
suite (V1 seed 31, V2 seed 157). Full mechanism documented in
`bufferHasSerializeHostileWrappedRow` and the suite's headline comment.

- **V1 (cell loss):** a wrapped continuation row starting with a NULL cell
  passes the addon's wrap-validity ternary, gets skipped with `CUF` which clamps
  at the right margin, overwriting the previous row's last cell and shifting the
  tail left by one. `cols=20: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ12\r\n' then '\x1b[1A\x1b[1K'`.
- **V2 (stray `-` filler):** a wrapped pair whose source row is entirely null
  takes the forced-wrap "magic" path; cleanup emits `ESC[0C` (param 0 → 1) so
  the ECH erase lands one cell right and the first filler `-` survives.

**Impact:** any snapshot consumer (hidden reveal, parked-tab reveal, sleep/wake,
mobile subscribe replay) paints lost/shifted characters or stray `-` fillers
when a TUI erases inside a soft-wrapped line. Tolerated + counted by the suite;
unskip the repros when upstream fixes or a local serialize post-processor lands.

---

## Bug B — SerializeAddon loses BOLD when serializing a dim→bold-only transition

**Classification: (a) real `@xterm/addon-serialize` bug.** New finding.

**Seeds:** 435, 770 (alt-screen), 1321 (minimal, 2 ops).

**Minimal repro (isolated, no fuzz corpus needed), cols=20:**

```
live bytes:        "\x1b[2mA\x1b[22m\x1b[1mB"
SerializeAddon → : "\x1b[2mA\x1b[1;22mB"
live cell B:       bold=1 dim=0   (style flags 100000)
restored cell B:   bold=0 dim=0   (style flags 000000)   ← BOLD LOST
```

**Mechanism:** cell A is dim, cell B is bold-only. The serializer diffs the pen
from A (dim on) to B (bold on, dim off). To clear dim it appends SGR 22 — but in
xterm/ECMA-48 **SGR 22 resets *both* bold and dim** (`normalIntensity`). So the
emitted `\x1b[1;22m` sets bold then immediately clears it: the restored cell is
neither dim nor bold. Verified directly: writing `\x1b[1;22mX` yields `bold=0`.
(`\x1b[1;2m` — the same-cell dim+bold case — round-trips fine, so the bug is
specific to a dim-cell → bold-only-cell attribute transition.)

**Why it garbles a real pane:** agent TUIs routinely draw a dim body line then a
bold status/spinner line (Claude Code, Codex). On the live screen the status
line is bold; after a hide→reveal snapshot restore it renders normal-weight.
The seed-1321 live row `⠦ bash: pnpm typecheck` is bold live, non-bold restored.

**Repro test:** `headless-emulator-fidelity.fuzz.test.ts` →
`it.skip('drops bold when serializing a dim cell followed by a bold-only cell …')`.

---

## Bug C — SerializeAddon cursor restore is off-by-one when the last content row fills the right margin

**Classification: (a) real `@xterm/addon-serialize` bug.** New finding.

**Seeds:** 454 (minimal, plain CUP), 1696 (DECSC/DECRC + wide CJK).

**Minimal repro (isolated, pure serializer replay), cols=10:**

```
live bytes:        "0123456789\x1b[3;5H"   (fill row 0 to the margin, CUP to r3c5)
SerializeAddon → : "0123456789\x1b[2B\x1b[6D"
live cursor:       { x: 4, y: 2 }
restored cursor:   { x: 3, y: 2 }          ← ONE COLUMN SHORT
```

Control (`"012\x1b[3;5H"` — row 0 not full) serializes to `"012\x1b[2B\x1b[1C"`
and round-trips the cursor exactly, isolating the trigger to a full-width final
content row.

**Mechanism:** after emitting a row filled to exactly `cols`, xterm is left in
the *wrap-pending* state (cursor visually on the last column, logically "one
past"). The serializer computes its final cursor-restore as relative
`CUD`/`CUB` moves from that ambiguous position; the horizontal delta is computed
one column short, so the restored cursor lands at `x-1`. Reproduced with pure
`serializeAddon.serialize()` replay into a fresh terminal — **no Orca preamble
or normalization involved**, confirming it is upstream, not Orca's snapshot
path.

**Why it garbles a real pane:** the cursor is where the next keystroke echoes
and where the block/bar cursor is drawn. On reveal of a TUI whose bottom line
reached the right edge (wide status lines, long prompts), the cursor sits one
cell left of where the live pane had it — visible as a mispositioned prompt
caret or spinner, and subsequent input can overwrite the wrong cell.

**Repro test:** `headless-emulator-fidelity.fuzz.test.ts` →
`it.skip('restores the cursor one column short when the last row fills the margin …')`.

---

## Bug D — snapshot does not preserve the DECSC saved-cursor register across a hide/reveal boundary

**Classification: (a) real bug — a structural snapshot limitation.** New
finding, surfaced by the reveal-reconciliation fuzz (suite 2), not the fidelity
fuzz.

**Minimal repro (cols=20):**

```
hidden bytes: "AB\x1b7\x1b[4;10HCD"   (write AB, DECSC saves cursor at r0c2,
                                        move to r3c9, write CD)
tail bytes:   "\x1b8X"                 (DECRC restores the saved cursor, write X)

live (always visible):  rows ["ABX", "         CD"]   cursor { x: 3, y: 0 }
reveal (snapshot+tail): rows ["XB",  "         CD"]   cursor { x: 1, y: 0 }
                                ^^ 'X' overwrote 'A' — DECRC landed at home, not r0c2
snapshotAnsi:           "AB\r\n\r\n\r\n\x1b[9CCD"   (no saved-cursor state at all)
```

**Mechanism:** the snapshot is a serialized *screen* (SerializeAddon) plus a few
rehydrated modes. The VT100 DECSC/DECRC saved-cursor register (also `CSI s` /
`CSI u`) is runtime state that never appears in the serialized buffer, so it
cannot survive a snapshot. When a hidden TUI runs `\x1b7` (or `\x1b[s`) before
the reveal seq and the racing tail (or any post-reveal output) runs `\x1b8` (or
`\x1b[u`), the restore targets the fresh terminal's default saved position
(home) instead of where the TUI saved it — the next writes land at the wrong
cell and overwrite live content.

**Why it garbles a real pane:** DECSC/DECRC is common in shell prompts and
status-line redraws (save cursor, jump to a corner to paint a clock/token
counter, restore). If the save happens while the pane is hidden and the restore
fires on reveal, the restored paint clobbers the wrong cells. Found by suite-2
seed 3 (a `savedCursorDetour` op whose `\x1b7` fell in the hidden prefix and
whose `\x1b8` fell in the racing tail after chunk-splitting).

**Handling:** suite 2 keeps its racing tail append-only (no DECSC/DECRC, cursor
motion, scroll regions, or alt frames) so the seq-reconciliation byte-stitch is
tested in isolation from this and the other terminal-state-loss garbles. Bug D
is instead pinned as a standalone repro,
`hidden-reveal-reconciliation.fuzz.test.ts` →
`it.skip('preserves the DECSC saved-cursor register across a hide/reveal …')`.

**Fix direction (not applied — no production changes in this task):** carry the
saved-cursor register out-of-band in the snapshot (like `oscLinks`), or have the
emulator re-emit a synthetic DECSC restoring the saved position after replay.

---

## Bug E — snapshot boundary mid-escape-sequence drops the partial sequence

**Classification: (a) real bug — a structural snapshot limitation.** New
finding, surfaced by the reveal-reconciliation fuzz (suite 2).

**Minimal repro (cols=20):**

```
hidden prefix: "AB\x1b[3"   (write AB, then ESC [ 3 — no final byte yet)
tail bytes:    "mCD"        ('m' completes ESC[3m = italic, then CD)

live (always visible):  rows ["ABCD"]    (ESC[3m parsed atomically, CD italic)
reveal (snapshot+tail): rows ["ABmCD"]   ← 'm' became a literal character
snapshotAnsi:           "AB"             (the partial ESC[3 is in the parser, gone)
```

**Mechanism:** a PTY read (one delivery record) can split an escape sequence.
If the pane is revealed while the emulator's parser sits mid-`ESC[…`, the
serialized SCREEN cannot carry the partial sequence (it lives in the parser
state machine, not the buffer). The racing tail supplies the sequence's
remaining bytes, but with the prefix gone the terminal parses them as literal
text. Reproduced end-to-end against the real `HeadlessEmulator.getSnapshot`.

**Why it garbles a real pane:** any TUI whose output is heavy with escape
sequences (all of them) can have a read boundary fall mid-escape; if a reveal
lands in that window the continuation renders as stray literal bytes (a rogue
`m`, `H`, digits) injected into the visible text.

**Reachability:** requires the reveal/snapshot to fire in the gap between the two
halves of a split escape. `main` writes each PTY read to the emulator and
records it as one delivery unit (`session.ts emitSubprocessOutput`), and the
snapshot is taken synchronously at a drain — so the window is a single delivered
record that ended mid-escape. Narrow but real.

**Handling:** suite 2 tolerates + counts scenarios whose hidden prefix ends
mid-escape-sequence (`prefixEndsMidSequence`), the same way suite 1 tolerates the
serialize wrap bug — it fired on ~24% of the corpus, confirming the class is
common. Pinned by `hidden-reveal-reconciliation.fuzz.test.ts` →
`it.skip('completes an escape sequence split across the hide/reveal boundary')`.

**Fix direction (not applied):** have `main` hold a trailing incomplete escape
out of the drain until it completes (a small parser-aware buffer), or defer the
snapshot to a parser-clean boundary.

---

## Known-legitimate normalization (NOT bugs)

- **OSC 8 hyperlink underline** — classification (c). xterm marks OSC-8 link
  cells underlined; SerializeAddon never re-emits OSC 8. Production restores the
  link ranges out-of-band via `snapshot.oscLinks`
  (`collectHeadlessOscLinkRanges`), so byte replay keeps the text but drops the
  underline by design. Pinned by the passing
  `it('drops OSC 8 underline from byte replay but preserves the range …')`.
- **P256→P16 color mode** — classification (c). SerializeAddon re-emits palette
  indices 0–15 written as `38;5;N` using classic SGR 30–37/90–97, so a restored
  cell reports `CM_P16` where live reported `CM_P256`. Both resolve through the
  same 16 theme slots — no visual difference. Canonicalized by
  `canonicalColorMode` in the parity fixture.

---

## Corpus vs deep mode

- Default `FUZZ_ITERATIONS=300`: <60s combined with suite 2. Hits only tolerated
  Bug-A seeds in range → green.
- `FUZZ_ITERATIONS=2000`: surfaces Bugs B and C as live corpus divergences. They
  are NOT auto-tolerated (unlike Bug A, which has a structural buffer predicate);
  a dim→bold-only transition or a margin-filling final row is not cheaply
  detectable from buffer state alone without re-deriving the serializer's pen
  diff. They are instead pinned as standalone `test.skip` repros. If you raise
  the default corpus past ~430 you must either add the same
  `test.skip`-with-predicate tolerance or the suite will (correctly) fail on the
  first Bug-B/Bug-C seed.
- `FUZZ_SEED=<n>`: re-run exactly one seed for a repro.

import { describe, expect, it } from 'vitest'
import { Terminal } from '@xterm/headless'
import { HeadlessEmulator } from '../../../../main/daemon/headless-emulator'
import { POST_REPLAY_LIVE_SNAPSHOT_RESET } from './layout-serialization'

// Repro for #6106: "SSH terminal loses pre-TUI shell output after Codex tab
// restore".
//
// Scenario: on an SSH-backed terminal the user prints some shell output
// (PRE_CODEX_START, `ls` output incl. AGENTS.md, PRE_CODEX_END), then starts a
// TUI (codex) which enters the alternate screen. When the tab is hidden and
// restored, the pre-TUI scrollback disappears.
//
// This test drives the REAL host serializer (HeadlessEmulator.getSnapshot ->
// SerializeAddon + buildRehydrateSequences + splitTerminalSnapshotAnsi) and a
// REAL renderer-side xterm through the two restore branches that
// applyMainBufferSnapshot() actually writes (pty-connection.ts). It shows that
// the REMOTE/SSH branch loses the pre-TUI scrollback while the LOCAL branch
// keeps it.
//
// Root cause: the remote snapshot pathway (remote-runtime-terminal-multiplexer
// resolve type, and serializeBudgetedRequestedSnapshot folding scrollbackAnsi
// into `data`) drops the `alternateScreen` / `scrollbackAnsi` split fields that
// the local getMainBufferSnapshot path carries. So applyMainBufferSnapshot sees
// `alternateScreen === undefined` and takes the `!alternateScreen` branch, which
// clears + rewrites the CURRENTLY-ACTIVE (alternate) buffer instead of first
// returning to the normal buffer to rebuild scrollback.

// ── Verbatim restore writes from applyMainBufferSnapshot (pty-connection.ts) ──
// REMOTE/SSH branch — snapshot.alternateScreen is undefined, so restore takes
// the `!snapshot.alternateScreen` path (pty-connection.ts:6520-6525):
const REMOTE_RESTORE_CLEAR = '\x1b[2J\x1b[3J\x1b[H'
// LOCAL branch — snapshot.alternateScreen === true && scrollbackAnsi !== undefined
// (pty-connection.ts:6526-6531):
const LOCAL_RESTORE_PREFIX = '\x1b[?1049l\x1b[2J\x1b[3J\x1b[H'
const LOCAL_RESTORE_ENTER_ALT = '\x1b[0m\x1b[?1049h\x1b[2J\x1b[H'

function writeXterm(term: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => term.write(data, () => resolve()))
}

async function emulatorWrite(emu: HeadlessEmulator, data: string): Promise<void> {
  await emu.write(data)
}

/** Scan the ENTIRE normal buffer (scrollback + viewport), which is where
 *  pre-TUI shell output must live after a restore. */
function readNormalBuffer(term: Terminal): string {
  const buf = term.buffer.normal
  const lines: string[] = []
  for (let y = 0; y < buf.length; y += 1) {
    lines.push(buf.getLine(y)?.translateToString(true) ?? '')
  }
  return lines.join('\n')
}

/** Build the host emulator state the SSH daemon would hold: pre-TUI shell
 *  output pushed into scrollback, then a codex TUI painting the alt screen. */
async function buildSshHostEmulator(): Promise<HeadlessEmulator> {
  // Small viewport so the pre-TUI output is guaranteed to scroll off-screen
  // into normal-buffer scrollback before the TUI starts.
  const emu = new HeadlessEmulator({ cols: 40, rows: 6, scrollback: 5000 })
  await emulatorWrite(emu, 'PRE_CODEX_START\r\n')
  await emulatorWrite(emu, '$ ls | head -5\r\n')
  await emulatorWrite(emu, 'AGENTS.md\r\nREADME.md\r\npackage.json\r\nsrc\r\ndocs\r\n')
  await emulatorWrite(emu, 'PRE_CODEX_END\r\n')
  // Push a few more prompts so the earliest markers are firmly in scrollback.
  await emulatorWrite(emu, '$ \r\n$ \r\n$ \r\n$ codex\r\n')
  // codex starts: enter alternate screen and paint its own frame.
  await emulatorWrite(emu, '\x1b[?1049h\x1b[2J\x1b[H')
  await emulatorWrite(emu, 'CODEX TUI FRAME\r\n> ')
  return emu
}

describe('#6106 SSH terminal loses pre-TUI scrollback after Codex tab restore', () => {
  it('host snapshot separates pre-TUI scrollback from the alt frame', async () => {
    const emu = await buildSshHostEmulator()
    const snapshot = emu.getSnapshot({ scrollbackRows: 5000 })
    try {
      expect(snapshot.modes.alternateScreen).toBe(true)
      // The pre-TUI output IS captured by the host serializer — in scrollbackAnsi,
      // NOT in the alt-frame snapshotAnsi.
      expect(snapshot.scrollbackAnsi).toContain('PRE_CODEX_START')
      expect(snapshot.scrollbackAnsi).toContain('AGENTS.md')
      expect(snapshot.snapshotAnsi).toContain('CODEX TUI FRAME')
      expect(snapshot.snapshotAnsi).not.toContain('PRE_CODEX_START')
    } finally {
      // no explicit dispose API needed for the test emulator
    }
  })

  it('BUG: remote/SSH restore branch discards the pre-TUI scrollback', async () => {
    const emu = await buildSshHostEmulator()
    const snapshot = emu.getSnapshot({ scrollbackRows: 5000 })

    // What the SSH host actually sends over the wire: serializeBudgetedRequested-
    // Snapshot folds scrollbackAnsi INTO `data`
    // (rpc/methods/terminal.ts:619 -> `(serialized.scrollbackAnsi ?? '') + serialized.data`),
    // and the remote multiplexer's snapshot resolve type carries NO
    // `alternateScreen` / `scrollbackAnsi` fields
    // (remote-runtime-terminal-multiplexer.ts:106-120). So the renderer restore
    // sees only `{ data }`.
    const remoteData = (snapshot.scrollbackAnsi ?? '') + snapshot.rehydrateSequences + snapshot.snapshotAnsi

    // The pane was showing codex when hidden, so the renderer xterm is STILL on
    // the alternate screen at restore time.
    const term = new Terminal({ cols: 40, rows: 6, scrollback: 5000, allowProposedApi: true })
    await writeXterm(term, '\x1b[?1049h\x1b[2J\x1b[HOLD CODEX FRAME')

    // applyMainBufferSnapshot with alternateScreen === undefined -> `!alternateScreen`
    // branch: clear the *currently active* (alt) buffer, then write data.
    await writeXterm(term, REMOTE_RESTORE_CLEAR)
    await writeXterm(term, remoteData)
    await writeXterm(term, POST_REPLAY_LIVE_SNAPSHOT_RESET)

    // Return to the normal buffer (what the user sees after codex exits / scrolls up).
    await writeXterm(term, '\x1b[?1049l')
    const normal = readNormalBuffer(term)

    // BUG PINNED: the pre-TUI shell output is GONE from the normal buffer.
    // Correct behavior would keep PRE_CODEX_START / AGENTS.md available.
    expect(normal).not.toContain('PRE_CODEX_START')
    expect(normal).not.toContain('AGENTS.md')
  })

  it('CONTROL: local restore branch (with alternateScreen + scrollbackAnsi) keeps scrollback', async () => {
    const emu = await buildSshHostEmulator()
    const snapshot = emu.getSnapshot({ scrollbackRows: 5000 })

    // Local getMainBufferSnapshot delivers `data` (alt frame only), plus separate
    // `scrollbackAnsi` and `alternateScreen: true`. `data` here is
    // rehydrateSequences + snapshotAnsi (scrollbackAnsi is NOT folded in).
    const localData = snapshot.rehydrateSequences + snapshot.snapshotAnsi

    const term = new Terminal({ cols: 40, rows: 6, scrollback: 5000, allowProposedApi: true })
    await writeXterm(term, '\x1b[?1049h\x1b[2J\x1b[HOLD CODEX FRAME')

    // applyMainBufferSnapshot alternateScreen===true && scrollbackAnsi!==undefined
    // branch: return to normal buffer, rebuild it from scrollbackAnsi, re-enter alt.
    await writeXterm(term, LOCAL_RESTORE_PREFIX)
    await writeXterm(term, snapshot.scrollbackAnsi ?? '')
    await writeXterm(term, LOCAL_RESTORE_ENTER_ALT)
    await writeXterm(term, localData)
    await writeXterm(term, POST_REPLAY_LIVE_SNAPSHOT_RESET)

    await writeXterm(term, '\x1b[?1049l')
    const normal = readNormalBuffer(term)

    // Correct behavior: pre-TUI shell output survives the restore.
    expect(normal).toContain('PRE_CODEX_START')
    expect(normal).toContain('AGENTS.md')
  })
})

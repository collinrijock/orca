import { describe, expect, it } from 'vitest'
import {
  recognizeAgentProcess,
  recognizeAgentProcessFromCommandLine
} from './agent-process-recognition'

// Repro for issue #8259: Orca doesn't recognize a Cursor agent session in the
// sidebar on Windows.
//
// Cursor's Windows launcher does not run a process literally named
// `cursor-agent`. It runs the bundled Node runtime (`node.exe`) against a
// versioned script whose entrypoint basename is `index.js` living under a
// `cursor-agent\<version>\` directory. Orca's foreground detection
// (`recognizeAgentProcessFromCommandLine`, used by
// windows-agent-foreground-process.ts) only recognizes a node wrapper when the
// script basename itself normalizes to a known agent (e.g. `codex.js`) OR the
// path matches a `NODE_PACKAGE_SCRIPT_ENTRYPOINTS` marker (only codex/gemini).
// Cursor has neither, so the wrapped launch is not recognized and no sidebar
// icon/status appears.
describe('repro #8259: Cursor node.exe wrapper on Windows', () => {
  it('sanity: a bare `cursor-agent` process IS recognized (non-Windows path works)', () => {
    // Baseline: when the process name really is `cursor-agent`, detection works.
    expect(recognizeAgentProcess('cursor-agent')).toEqual({
      agent: 'cursor',
      processName: 'cursor-agent'
    })
    expect(recognizeAgentProcessFromCommandLine('cursor-agent "Review this file"')).toEqual({
      agent: 'cursor',
      processName: 'cursor-agent'
    })
  })

  it('BUG: Cursor launched as versioned node.exe ...\\cursor-agent\\...\\index.js is NOT recognized', () => {
    // This is the exact shape reported in #8258/#8259: the bundled node runtime
    // executing the versioned Cursor entrypoint `index.js`.
    const windowsCursorCommand = String.raw`C:\Users\alice\.local\share\cursor-agent\versions\2025.10.14-1a2b3c\node.exe C:\Users\alice\.local\share\cursor-agent\versions\2025.10.14-1a2b3c\index.js`

    // BUG: this pins the current (wrong) behavior. Detection returns null, so
    // Orca shows no Cursor icon or agent status in the sidebar.
    // CORRECT behavior would be: { agent: 'cursor', processName: 'cursor-agent' }.
    expect(recognizeAgentProcessFromCommandLine(windowsCursorCommand)).toBeNull()

    // The raw process name is just the node runtime, also unrecognized.
    // CORRECT: still surface as cursor via the cmdline path above.
    expect(
      recognizeAgentProcess(
        String.raw`C:\Users\alice\.local\share\cursor-agent\versions\2025.10.14-1a2b3c\node.exe`
      )
    ).toBeNull()
  })

  it('BUG: even a clean `node <path>/cursor-agent/.../index.js` argv is NOT recognized', () => {
    // Same failure via the simpler `node index.js` argv form (e.g. as WMIC/PS
    // CommandLine would report it), confirming the miss is in the entrypoint
    // matcher, not path escaping.
    const command = String.raw`node C:\Users\alice\.local\share\cursor-agent\versions\2025.10.14\index.js`
    // BUG (current): null. CORRECT: { agent: 'cursor', processName: 'cursor-agent' }.
    expect(recognizeAgentProcessFromCommandLine(command)).toBeNull()
  })
})

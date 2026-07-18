// Repro for stablyai/orca#5657 — macOS startup PATH probe hangs (unkillable,
// requires reboot) under Endpoint Security agents (Jamf Protect / CrowdStrike).
//
// Root cause pinned here: the startup PATH probe in hydrate-shell-path.ts spawns
// the user's login shell as an INTERACTIVE login shell (`-ilc`). An interactive
// shell sources the user's full ~/.zshrc, which commonly forks many subprocesses
// (oh-my-zsh, `compinit`, `source <(tool completion zsh)`, nvm, sdkman, ...).
// On a managed Mac every nested exec must be authorized by each active ES
// extension via ES_EVENT_TYPE_AUTH_EXEC before the kernel proceeds; under load
// those verdicts stall and the spawn wedges in the kernel uninterruptibly (state
// `U`), which no SIGKILL can reap.
//
// The issue's suggested fix #2 is to probe PATH WITHOUT a full interactive shell
// — e.g. `zsh -lc 'printf %s "$PATH"'` (login, NON-interactive), which sources
// login profiles but skips compinit / completion / plugin subprocess spawns.
//
// This test IMPORTS THE REAL product module and drives the REAL
// spawnShellAndReadPath path (no spawner override) so it observes the actual
// flags the shipped code passes to child_process.spawn.
//
// The assertions below PASS on the current tree while encoding the WRONG/buggy
// behavior: they assert the probe uses the interactive `-i` flag. When the bug
// is fixed (non-interactive login probe), the marked assertions should flip.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { delimiter } from 'node:path'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { _resetHydrateShellPathCache, hydrateShellPath } from './hydrate-shell-path'

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn()
}))

vi.mock('child_process', () => ({
  spawn: spawnMock
}))

function createMockShellProcess(): ChildProcessWithoutNullStreams {
  const proc = new EventEmitter() as ChildProcessWithoutNullStreams
  Object.assign(proc, {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    stdin: new EventEmitter(),
    kill: vi.fn()
  })
  return proc
}

describe('repro #5657: startup PATH probe spawns a spawn-heavy INTERACTIVE shell', () => {
  beforeEach(() => {
    _resetHydrateShellPathCache()
    spawnMock.mockReset()
  })

  afterEach(() => {
    _resetHydrateShellPathCache()
  })

  it('drives the real probe and observes the actual shell flags', async () => {
    const proc = createMockShellProcess()
    spawnMock.mockReturnValue(proc)

    // No `spawner` override → exercises the REAL spawnShellAndReadPath, so we
    // capture the exact argv the shipped code hands to child_process.spawn.
    const resultPromise = hydrateShellPath({ shellOverride: '/bin/zsh', force: true })

    // spawn() is invoked synchronously inside the Promise executor.
    expect(spawnMock).toHaveBeenCalledTimes(1)
    const [shellArg, argv] = spawnMock.mock.calls[0] as [string, string[], unknown]
    expect(shellArg).toBe('/bin/zsh')

    const shellFlags = argv[0]

    // --- BUG PIN #1 -------------------------------------------------------
    // The probe requests an INTERACTIVE shell (`i` in the flag bundle). This is
    // precisely what forces ~/.zshrc's compinit/oh-my-zsh/completion-generator
    // subprocess spawns, which stall in AUTH_EXEC and wedge posix_spawn under an
    // ES agent. CORRECT behavior (issue fix #2): a NON-interactive login probe,
    // e.g. `-lc`, so no `i`.
    expect(shellFlags).toContain('i') // BUG: interactive — should be absent
    expect(shellFlags).toBe('-ilc') // BUG: shipped flags; fix would be '-lc'
    // ----------------------------------------------------------------------

    // Let the probe resolve cleanly so the test doesn't leak a pending timer.
    const path = ['/usr/bin', '/bin'].join(delimiter)
    proc.stdout.emit('data', Buffer.from(`__ORCA_SHELL_PATH__${path}__ORCA_SHELL_PATH__`))
    proc.emit('close')

    const result = await resultPromise
    expect(result.ok).toBe(true)
    expect(result.segments).toEqual(['/usr/bin', '/bin'])
  })

  it('documents the correct fix: a non-interactive login probe would omit `i`', () => {
    // This is the shape the fixed argv should take. It is asserted here purely
    // as documentation of intent; it does NOT run the product code.
    const desiredFixedFlags = '-lc'
    expect(desiredFixedFlags).not.toContain('i')
  })
})

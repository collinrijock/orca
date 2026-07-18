import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClaudeRuntimePathResolver } from './runtime-paths'

// Repro for stablyai/orca#7740:
//   "Either not following CLAUDE_CONFIG_DIR or not loading shell env properly?"
//
// Root cause: ClaudeRuntimePathResolver.getRuntimePaths() derives the Claude
// config dir SOLELY from `process.env.CLAUDE_CONFIG_DIR`. In a GUI-launched
// Orca that env is the login-shell snapshot captured at app launch; it never
// re-sources the user's interactive `~/.zshrc` per terminal/agent spawn. A user
// who exports `CLAUDE_CONFIG_DIR` from `~/.zshrc` (or adds it after launch) is
// therefore invisible to this resolver, so it falls back to the DEFAULT
// `~/.claude`, mkdirSync-materializes it, and injects an EMPTY env patch — which
// is exactly the reported symptom ("it tried to create the default claude
// config directory" even though CLAUDE_CONFIG_DIR is set).
//
// These tests PASS on the current tree while pinning the BUGGY behavior. The
// comments mark which assertions encode the bug and what correct behavior is.

describe('repro-7740: CLAUDE_CONFIG_DIR resolved only from launch-time process.env', () => {
  let savedConfigDir: string | undefined
  let savedHome: string | undefined
  let tmpHome: string

  beforeEach(() => {
    savedConfigDir = process.env.CLAUDE_CONFIG_DIR
    savedHome = process.env.HOME
    // Redirect HOME so the resolver's mkdirSync of the default `~/.claude`
    // lands in a throwaway dir instead of the developer's real home.
    tmpHome = mkdtempSync(join(tmpdir(), 'orca-7740-home-'))
    process.env.HOME = tmpHome
    // Sanity: os.homedir() must honor the HOME override on this platform,
    // otherwise the "default dir" assertion below would touch the real ~/.claude.
    if (homedir() !== tmpHome) {
      throw new Error('test precondition: os.homedir() does not follow $HOME')
    }
  })

  afterEach(() => {
    if (savedConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR
    } else {
      process.env.CLAUDE_CONFIG_DIR = savedConfigDir
    }
    if (savedHome === undefined) {
      delete process.env.HOME
    } else {
      process.env.HOME = savedHome
    }
    rmSync(tmpHome, { recursive: true, force: true })
  })

  it('BUG: ignores a shell-exported CLAUDE_CONFIG_DIR that is absent from the launch snapshot', () => {
    // Simulate the field scenario: the user exports CLAUDE_CONFIG_DIR only from
    // their interactive ~/.zshrc, so the GUI-launched main process (whose env
    // is the login-shell snapshot) never captured it.
    delete process.env.CLAUDE_CONFIG_DIR

    const paths = new ClaudeRuntimePathResolver().getRuntimePaths()

    // BUG: falls back to the DEFAULT ~/.claude instead of the user's intended
    // dir. Correct behavior would be to honor the user's CLAUDE_CONFIG_DIR
    // (e.g. by re-sourcing the shell env per spawn, or reading the terminal's
    // resolved env), NOT silently default.
    expect(paths.configDir).toBe(join(tmpHome, '.claude'))

    // BUG: it materializes that default dir on disk — this is the "it tried to
    // create the default claude config directory" the reporter saw.
    expect(existsSync(paths.configDir)).toBe(true)

    // BUG: no CLAUDE_CONFIG_DIR is injected into the spawn env, so nothing
    // downstream can re-point Claude at the user's dir. Correct behavior would
    // carry the user's CLAUDE_CONFIG_DIR here.
    expect(paths.envPatch).toEqual({})
  })

  it('CONTROL: only honors CLAUDE_CONFIG_DIR when it is present in process.env (i.e. after a full relaunch)', () => {
    // This mirrors the reporter's step 4: a full Cmd+Q relaunch bakes the var
    // into the launch snapshot, and only THEN does the resolver honor it —
    // proving the sole source of truth is process.env, never a per-spawn
    // re-source of the user's shell.
    const userConfigDir = mkdtempSync(join(tmpdir(), 'orca-7740-cfg-'))
    process.env.CLAUDE_CONFIG_DIR = userConfigDir
    try {
      const paths = new ClaudeRuntimePathResolver().getRuntimePaths()
      expect(paths.configDir).toBe(userConfigDir)
      expect(paths.envPatch).toEqual({ CLAUDE_CONFIG_DIR: userConfigDir })
    } finally {
      rmSync(userConfigDir, { recursive: true, force: true })
    }
  })
})

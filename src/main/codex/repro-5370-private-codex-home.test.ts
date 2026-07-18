/*
 * Repro for issue #5370:
 * "Orca's private CODEX_HOME causes a Codex auth-revocation war with ~/.codex"
 *
 * Design fact under test (the code-verifiable half of the report): Orca does NOT
 * point Codex at the user's canonical `~/.codex`. It injects a *private*,
 * Orca-owned CODEX_HOME (`<userData>/codex-runtime-home/home`) that carries its
 * OWN `auth.json` — a second, independent Codex OAuth session on the same
 * OpenAI account. Because Codex/ChatGPT OAuth uses single-use refresh tokens
 * (one active session per account), the two homes' tokens revoke each other
 * whenever either side refreshes. The server-side revocation loop needs a live
 * OpenAI account, but the *precondition* — two distinct homes each holding a
 * distinct auth.json for the same account — is fully provable here.
 *
 * This test PASSES on the current tree while pinning the BUGGY design: the
 * injected CODEX_HOME is a separate directory from ~/.codex with its own
 * auth.json. Suggested fix #1/#2 in the issue (point runtime at ~/.codex, or
 * share/symlink auth.json) would make these paths equal / share one auth file
 * and would flip the asserts marked "BUG:".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type * as NodeOs from 'node:os'
import { dirname, join } from 'node:path'

const { homedirMock } = vi.hoisted(() => ({
  homedirMock: vi.fn<() => string>()
}))

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof NodeOs>('node:os')
  return { ...actual, homedir: homedirMock }
})

// Imported AFTER the mock so getSystemCodexHomePath() resolves the mocked home.
import { getSystemCodexHomePath, getOrcaManagedCodexHomePath } from './codex-home-paths'

describe('issue #5370: private CODEX_HOME vs ~/.codex', () => {
  let homeDir: string
  let userDataDir: string
  const originalUserDataPath = process.env.ORCA_USER_DATA_PATH

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'repro-5370-home-'))
    userDataDir = mkdtempSync(join(tmpdir(), 'repro-5370-userdata-'))
    homedirMock.mockReturnValue(homeDir)
    // getOrcaUserDataPath() honors this first, so the managed home is isolated.
    process.env.ORCA_USER_DATA_PATH = userDataDir
  })

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true })
    rmSync(userDataDir, { recursive: true, force: true })
    if (originalUserDataPath === undefined) {
      delete process.env.ORCA_USER_DATA_PATH
    } else {
      process.env.ORCA_USER_DATA_PATH = originalUserDataPath
    }
    vi.clearAllMocks()
  })

  it('injects a private runtime home that is NOT the user canonical ~/.codex', () => {
    const systemHome = getSystemCodexHomePath()
    const managedHome = getOrcaManagedCodexHomePath()

    // The canonical home Codex uses everywhere outside Orca.
    expect(systemHome).toBe(join(homeDir, '.codex'))

    // BUG: Orca launches Codex under a *separate* Orca-owned home instead of
    // the canonical one. A fix per the issue would make these equal.
    expect(managedHome).not.toBe(systemHome)
    expect(managedHome).toBe(join(userDataDir, 'codex-runtime-home', 'home'))
    // Not even nested under ~/.codex — a wholly independent tree.
    expect(managedHome.startsWith(systemHome)).toBe(false)
  })

  it('each home carries its OWN auth.json — two sessions for one account', () => {
    const systemAuthPath = join(getSystemCodexHomePath(), 'auth.json')
    const managedAuthPath = join(getOrcaManagedCodexHomePath(), 'auth.json')
    // getSystemCodexHomePath() only resolves the path; ~/.codex is created by
    // `codex login`, so materialize it here to stand in for that login.
    mkdirSync(dirname(systemAuthPath), { recursive: true })

    // Simulate the canonical login (what `codex login` writes to ~/.codex),
    // then a divergent refresh-token rotation inside Orca's private home —
    // exactly the state the report observes when the daemon refreshes.
    writeFileSync(systemAuthPath, JSON.stringify({ tokens: { refresh_token: 'RT-canonical-1' } }))
    writeFileSync(managedAuthPath, JSON.stringify({ tokens: { refresh_token: 'RT-orca-2' } }))

    // BUG: two independent auth.json files exist at two independent paths.
    expect(managedAuthPath).not.toBe(systemAuthPath)
    expect(dirname(managedAuthPath)).not.toBe(dirname(systemAuthPath))

    const canonicalRefresh = JSON.parse(readFileSync(systemAuthPath, 'utf-8')).tokens.refresh_token
    const orcaRefresh = JSON.parse(readFileSync(managedAuthPath, 'utf-8')).tokens.refresh_token

    // BUG: the two homes hold DIFFERENT refresh tokens for the same OpenAI
    // account simultaneously. With single-use server-side rotation, whichever
    // home last refreshed has revoked the other's token — the "revocation war".
    // Correct behavior (shared auth) would make these identical / one file.
    expect(canonicalRefresh).toBe('RT-canonical-1')
    expect(orcaRefresh).toBe('RT-orca-2')
    expect(orcaRefresh).not.toBe(canonicalRefresh)
  })
})

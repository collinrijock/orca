/**
 * Repro for issue #1715 — "GitHub Projects uses the wrong gh host in
 * multi-host setups and incorrectly reports missing project scope".
 *
 * This test IMPORTS THE REAL product modules (no logic re-implementation) and
 * PINS two facets of the bug as they exist in the current tree. Each buggy
 * assertion is marked; the trailing comment states the CORRECT behavior.
 *
 * Facet A — paste-to-add is single-host biased: parseProjectPaste()'s URL
 * regex is hard-coded to `https://github.com/...`, so a GHES/GHE-hosted
 * project URL is rejected outright and can't be opened.
 *
 * Facet B — host-agnostic auth diagnosis: diagnoseGhAuth() takes NO host
 * argument and picks gh's globally *active* account. When the repo lives on a
 * non-default host whose token DOES have `project`, but the global-active
 * account (github.com) does not, Orca reports `project` as missing against the
 * wrong host — the misleading "missing project scope" message the issue
 * describes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseProjectPaste } from './project-view'

// ── Facet A: GHES project URL parsing (pure function, real module) ──────────
describe('repro #1715 A: parseProjectPaste rejects GHES-hosted project URLs', () => {
  it('parses a github.com project URL (works today)', () => {
    const parsed = parseProjectPaste('https://github.com/orgs/acme/projects/7')
    expect(parsed).toEqual({ kind: 'org', owner: 'acme', number: 7 })
  })

  it('BUG: a valid GHES project URL is rejected (returns null)', () => {
    // Same shape as the github.com URL above, only the host differs. A user
    // whose repo lives on a GHES instance pastes their real project URL.
    const gheUrl = 'https://ghe.example.com/orgs/acme/projects/7'
    const parsed = parseProjectPaste(gheUrl)

    // BUG: encodes the current wrong behavior — the GHES URL does not match the
    // `github.com`-only regex, so paste-to-add fails.
    expect(parsed).toBeNull()
    // CORRECT behavior would be:
    //   expect(parsed).toMatchObject({ kind: 'org', owner: 'acme', number: 7 })
    // (host captured/tracked so downstream gh calls target ghe.example.com).
  })

  it('BUG: a GHES /users/ project URL with a view is also rejected', () => {
    const parsed = parseProjectPaste('https://ghe.corp.internal/users/alice/projects/3/views/2')
    // BUG: rejected today; CORRECT would parse kind:'user', owner:'alice',
    // number:3, viewNumber:2 on the GHES host.
    expect(parsed).toBeNull()
  })
})

// ── Facet B: diagnoseGhAuth() ignores the repo host ─────────────────────────
// Mock the gh runner so we can feed multi-host `gh auth status` output.
vi.mock('../git/runner', () => ({
  ghExecFileAsync: vi.fn()
}))
import { ghExecFileAsync } from '../git/runner'
import { diagnoseGhAuth } from './auth-diagnose'

const mockedGh = vi.mocked(ghExecFileAsync)

describe('repro #1715 B: diagnoseGhAuth targets the global-active host, not the repo host', () => {
  beforeEach(() => {
    delete process.env.GH_TOKEN
    delete process.env.GITHUB_TOKEN
    // Two hosts logged in. github.com is the globally ACTIVE account and is
    // MISSING `project`. The GHES host (where the opened repo lives) HAS
    // `project`. A correct, host-aware diagnosis for a GHES repo would report
    // NO missing scopes.
    const status = `github.com
  ✓ Logged in to github.com account globaluser (keyring)
  - Active account: true
  - Token scopes: 'read:org', 'repo'

ghe.example.com
  ✓ Logged in to ghe.example.com account repouser (keyring)
  - Active account: false
  - Token scopes: 'project', 'read:org', 'repo'
`
    mockedGh.mockResolvedValue({ stdout: status, stderr: '' } as never)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('BUG: reports `project` missing using the github.com active account, ignoring the GHES repo host', async () => {
    const diag = await diagnoseGhAuth()

    // diagnoseGhAuth() takes no host parameter at all — it cannot be pointed
    // at the repo's host. It selects the globally active account:
    expect(diag.activeAccount?.host).toBe('github.com')

    // BUG: because it diagnosed the wrong host, `project` shows as missing even
    // though the GHES host (the repo's host) already has it. This is the
    // misleading "missing project scope" the issue reports.
    expect(diag.missingScopes).toContain('project')

    // Evidence the correct host DID have the scope — it's in the parsed
    // accounts list, just never consulted for the diagnosis.
    const gheAccount = diag.accounts.find((a) => a.host === 'ghe.example.com')
    expect(gheAccount?.scopes).toContain('project')

    // CORRECT behavior: given the repo host is ghe.example.com, the diagnosis
    // should consult that account and report:
    //   expect(diag.missingScopes).not.toContain('project')
  })
})

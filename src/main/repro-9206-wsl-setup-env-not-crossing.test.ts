/**
 * Repro for issue #9206 — ORCA_ROOT_PATH / ORCA_WORKTREE_PATH do not exist
 * inside the WSL setup script.
 *
 * On WSL, the setup-runner.sh runs inside `wsl.exe`. Env vars placed on the
 * Windows-side PTY spawn only cross into the Linux guest if their names are
 * registered in `WSLENV`. The setup env vars produced by
 * `getSetupRunnerEnvVars` (ORCA_ROOT_PATH, ORCA_WORKTREE_PATH, ...) are set on
 * the spawn env but `addOrcaWslInteropEnv` — the sole WSLENV gatekeeper on the
 * WSL spawn path (src/main/daemon/pty-subprocess.ts:759,
 * src/main/providers/local-pty-provider.ts) — does NOT list them. So inside WSL
 * bash `$ORCA_ROOT_PATH`/`$ORCA_WORKTREE_PATH` are empty and
 * `cp "$ORCA_ROOT_PATH/.env" "$ORCA_WORKTREE_PATH/.env"` becomes `cp /.env /.env`.
 *
 * This test PINS the buggy behavior: it PASSES today while asserting the WRONG
 * result (the setup vars are absent from WSLENV). When the bug is fixed the
 * marked assertions should flip.
 */
import { describe, expect, it, vi } from 'vitest'

import { addOrcaWslInteropEnv } from './pty/wsl-orca-env'

// hooks.ts touches fs / child_process / git runner at module load, so mock the
// same surfaces hooks.test.ts mocks in order to import the real generator.
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  rmSync: vi.fn(),
  chmodSync: vi.fn()
}))
vi.mock('child_process', () => ({
  exec: vi.fn(),
  execFile: vi.fn(),
  execFileSync: vi.fn(),
  spawn: vi.fn()
}))

// Import the REAL setup-env generator so the exact keys under test come from
// product code, not a re-implementation.
import { getSetupRunnerEnvVars } from './hooks'
import type { Repo } from '../shared/types'

function wslenvNames(env: Record<string, string>): string[] {
  return (env.WSLENV ?? '')
    .split(':')
    .filter(Boolean)
    .map((entry) => entry.split('/')[0])
}

describe('issue #9206 — WSL setup env vars do not cross into the guest', () => {
  const repo = { path: '/mnt/c/Users/xxx/repo' } as unknown as Repo
  const worktreePath = '/mnt/c/Users/xxx/repo-worktrees/dev'

  it('getSetupRunnerEnvVars really produces the vars the setup script relies on', () => {
    const env = getSetupRunnerEnvVars(repo, worktreePath)
    expect(env.ORCA_ROOT_PATH).toBe('/mnt/c/Users/xxx/repo')
    expect(env.ORCA_WORKTREE_PATH).toBe('/mnt/c/Users/xxx/repo-worktrees/dev')
  })

  it('BUG: the WSL interop gate omits the setup vars, so they never reach WSL bash', () => {
    // Simulate the WSL PTY spawn env: setup vars merged in, ready for wsl.exe.
    const spawnEnv: Record<string, string> = {
      ...getSetupRunnerEnvVars(repo, worktreePath),
      // A var that IS on the passthrough allowlist, to prove the gate works at all.
      ORCA_WORKTREE_ID: 'wt-123'
    }

    addOrcaWslInteropEnv(spawnEnv)
    const registered = wslenvNames(spawnEnv)

    // Sanity: the mechanism does forward allow-listed vars.
    expect(registered).toContain('ORCA_WORKTREE_ID')

    // --- BUG PINS (these SHOULD be present after a fix, but are absent today) ---
    expect(registered).not.toContain('ORCA_ROOT_PATH')
    expect(registered).not.toContain('ORCA_WORKTREE_PATH')
    expect(registered).not.toContain('ORCA_WORKSPACE_NAME')
    // Conductor/Ghostx compat vars are dropped too.
    expect(registered).not.toContain('CONDUCTOR_ROOT_PATH')
    expect(registered).not.toContain('GHOSTX_ROOT_PATH')

    // Consequence: the value exists on the Windows side but WSL never imports
    // it, so `cp "$ORCA_ROOT_PATH/.env" ...` resolves to `cp /.env ...`.
    expect(spawnEnv.ORCA_ROOT_PATH).toBe('/mnt/c/Users/xxx/repo')
    expect(registered.includes('ORCA_ROOT_PATH')).toBe(false)
  })
})

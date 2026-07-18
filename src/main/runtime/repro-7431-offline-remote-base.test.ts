import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Repro for issue #7431:
// `worktree create` hard-errors offline when the resolved base is a remote
// display name (e.g. `origin/main`) whose remote-tracking ref was never fetched
// into this clone, even though a same-named LOCAL branch `refs/heads/main`
// exists and could serve as an offline base.
//
// The create path in src/main/runtime/orca-runtime.ts (worktreeCreate) throws
// "Could not refresh base ref ..." at ~line 16265 only when BOTH:
//   hadRemoteTrackingBaseRef === false  AND  hasLocalWorktreeBaseRef(base) === false
// This test exercises the REAL building blocks that `hasLocalWorktreeBaseRef`
// composes (module-private in orca-runtime.ts):
//   resolveWorktreeAddBaseRef (shared/worktree-base-ref.ts)
//   hasWorktreeBaseCommitRef  (git/worktree-base-ref-probe.ts)
//   hasCommitObjectViaGitExec (git/commit-object-ref.ts)
// against a real git repo that has ONLY a local `main` branch, and pins the
// buggy result: the local `refs/heads/main` fallback is never consulted for the
// `origin/main` base, so the create path treats it as "no local base ref" and
// (when the refresh fetch fails offline) throws instead of falling back.
import { resolveWorktreeAddBaseRef } from '../../shared/worktree-base-ref'
import { hasWorktreeBaseCommitRef } from '../git/worktree-base-ref-probe'
import { hasCommitObjectViaGitExec } from '../git/commit-object-ref'
import { gitExecFileAsync } from '../git/runner'

let repoDir: string

function git(args: string[]): void {
  execFileSync('git', args, { cwd: repoDir, stdio: 'ignore' })
}

beforeAll(() => {
  repoDir = mkdtempSync(join(tmpdir(), 'repro-7431-'))
  // Fresh clone-like state: a local `main` branch with a commit, and NO
  // `refs/remotes/origin/main` (the remote-tracking ref was never fetched).
  execFileSync('git', ['init', '-q', '-b', 'main', repoDir], { stdio: 'ignore' })
  git(['config', 'user.email', 'repro@example.com'])
  git(['config', 'user.name', 'Repro'])
  git(['commit', '-q', '--allow-empty', '-m', 'root'])
})

afterAll(() => {
  if (repoDir) {
    rmSync(repoDir, { recursive: true, force: true })
  }
})

describe('issue #7431 offline base = origin/main with only a local main branch', () => {
  it('confirms the repo has a usable local refs/heads/main but no remote-tracking ref', async () => {
    // Sanity: the offline fallback that SHOULD be used really exists locally.
    await expect(hasWorktreeBaseCommitRef(repoDir, 'refs/heads/main')).resolves.toBe(true)
    // ...and the remote-tracking ref genuinely does not exist in this clone.
    await expect(hasWorktreeBaseCommitRef(repoDir, 'refs/remotes/origin/main')).resolves.toBe(false)
  })

  it('BUG: resolving base `origin/main` never tries refs/heads/main and stays unusable', async () => {
    const tried: string[] = []
    const refExists = (qualifiedRef: string) => {
      tried.push(qualifiedRef)
      return hasWorktreeBaseCommitRef(repoDir, qualifiedRef)
    }

    const resolved = await resolveWorktreeAddBaseRef('origin/main', refExists)

    // BUG (pinned): only the remote-tracking ref and a literal `origin/main`
    // branch are probed. The same-named local branch `refs/heads/main` is never
    // considered, so the base stays the unqualified display name.
    expect(tried).toEqual(['refs/remotes/origin/main', 'refs/heads/origin/main'])
    expect(resolved).toBe('origin/main')
    // CORRECT behavior would resolve to the local branch:
    // expect(resolved).toBe('refs/heads/main')
  })

  it('BUG: local-base-ref detection returns false, so offline create throws instead of falling back', async () => {
    // This mirrors hasLocalWorktreeBaseRef() in orca-runtime.ts exactly, using
    // the same real product functions in the same order.
    const refExists = (qualifiedRef: string) => hasWorktreeBaseCommitRef(repoDir, qualifiedRef)
    const baseRef = 'origin/main'

    const resolvedBaseRef = await resolveWorktreeAddBaseRef(baseRef, refExists)
    let hasLocalBaseRef: boolean
    if (resolvedBaseRef !== baseRef) {
      hasLocalBaseRef = true
    } else if (baseRef.startsWith('refs/')) {
      hasLocalBaseRef = await refExists(baseRef)
    } else {
      // `origin/main` is not a 40-char object id, so this short-circuits false
      // without ever touching the local `main` branch.
      hasLocalBaseRef = await hasCommitObjectViaGitExec(
        (gitArgs) => gitExecFileAsync(gitArgs, { cwd: repoDir }),
        baseRef
      )
    }

    // BUG (pinned): a usable local `main` exists, yet detection says there is no
    // local base ref -> the create path's guard
    //   if (!refreshResult.ok && !hadRemoteTrackingBaseRef) throw ...
    // fires when the offline refresh fetch fails, hard-erroring the create.
    expect(hasLocalBaseRef).toBe(false)
    // CORRECT behavior: hasLocalBaseRef === true (fall back to refs/heads/main).
  })

  it('control: a bare `main` base DOES resolve to the local branch (why the workaround --base-branch main works)', async () => {
    // Demonstrates the documented offline workaround: passing the bare local ref.
    const refExists = (qualifiedRef: string) => hasWorktreeBaseCommitRef(repoDir, qualifiedRef)
    await expect(resolveWorktreeAddBaseRef('main', refExists)).resolves.toBe('refs/heads/main')
  })

  it('control: an already-fetched remote-tracking clone resolves origin/main fine (not the buggy edge)', async () => {
    // When refs/remotes/origin/main IS present locally, resolution qualifies it,
    // so the offline stale-ref reuse path applies and no throw occurs. This is
    // the common offline case the issue notes does NOT hit the bug.
    const refExists = vi.fn(async (ref: string) => ref === 'refs/remotes/origin/main')
    await expect(resolveWorktreeAddBaseRef('origin/main', refExists)).resolves.toBe(
      'refs/remotes/origin/main'
    )
  })
})

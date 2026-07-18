/*
 * Repro for issue #9171 — "Wrong PR diffs displayed when checking out the default branch".
 *
 * Scenario: a repo's default branch is `master`. In the past someone opened a PR
 * whose HEAD was `master` (accidentally opening a PR *from* the default branch);
 * it was closed long ago. When the user checks out the default branch, Orca calls
 * getPRForBranch('<repo>', 'master') and looks up a PR purely by head branch name
 * via `GET /repos/{o}/{r}/pulls?head={owner}:master&state=all&per_page=1`. Because
 * `state=all` includes closed PRs, that stale closed PR is returned and attached to
 * the default-branch checkout — surfacing its (wrong) diffs and checks.
 *
 * getPRForBranchOutcome (src/main/github/client.ts:2962) has NO awareness of the
 * repo's default branch, so it never skips the head-branch lookup for `master`.
 *
 * This test PINS the buggy behavior: it PASSES today because the function returns
 * the stale closed PR. The assertions marked "BUG" encode the wrong result; the
 * "CORRECT" comments describe what should happen (no PR attached on the default
 * branch).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type RateLimitGuardResult =
  | { blocked: false }
  | { blocked: true; remaining: number; limit: number; resetAt: number }

const {
  execFileAsyncMock,
  ghExecFileAsyncMock,
  getOwnerRepoMock,
  getIssueOwnerRepoMock,
  getOwnerRepoForRemoteMock,
  resolvePRRepositoryCandidatesMock,
  getRemoteUrlForRepoMock,
  gitExecFileAsyncMock,
  getRateLimitMock,
  rateLimitGuardMock,
  noteRateLimitSpendMock,
  ghRepoExecOptionsMock,
  githubRepoContextMock,
  getSshGitProviderMock,
  readLocalGitConfigSignatureMock,
  acquireMock,
  releaseMock
} = vi.hoisted(() => ({
  execFileAsyncMock: vi.fn(),
  ghExecFileAsyncMock: vi.fn(),
  getOwnerRepoMock: vi.fn(),
  getIssueOwnerRepoMock: vi.fn(),
  getOwnerRepoForRemoteMock: vi.fn(),
  resolvePRRepositoryCandidatesMock: vi.fn(),
  getRemoteUrlForRepoMock: vi.fn(),
  gitExecFileAsyncMock: vi.fn(),
  getRateLimitMock: vi.fn(),
  rateLimitGuardMock: vi.fn<(bucket?: string) => RateLimitGuardResult>(() => ({
    blocked: false
  })),
  noteRateLimitSpendMock: vi.fn(),
  ghRepoExecOptionsMock: vi.fn((context) =>
    context.connectionId
      ? {}
      : {
          cwd: context.repoPath,
          ...(context.wslDistro ? { wslDistro: context.wslDistro } : {})
        }
  ),
  githubRepoContextMock: vi.fn((repoPath, connectionId, localGitOptions) => ({
    repoPath,
    connectionId: connectionId ?? null,
    ...localGitOptions
  })),
  getSshGitProviderMock: vi.fn(),
  readLocalGitConfigSignatureMock: vi.fn(),
  acquireMock: vi.fn(),
  releaseMock: vi.fn()
}))

vi.mock('./gh-utils', () => ({
  execFileAsync: execFileAsyncMock,
  ghExecFileAsync: ghExecFileAsyncMock,
  getOwnerRepo: getOwnerRepoMock,
  getIssueOwnerRepo: getIssueOwnerRepoMock,
  getOwnerRepoForRemote: getOwnerRepoForRemoteMock,
  resolvePRRepositoryCandidates: resolvePRRepositoryCandidatesMock,
  getRemoteUrlForRepo: getRemoteUrlForRepoMock,
  gitExecFileAsync: gitExecFileAsyncMock,
  ghRepoExecOptions: ghRepoExecOptionsMock,
  githubRepoContext: githubRepoContextMock,
  classifyGhError: (stderr: string) => {
    const lower = stderr.toLowerCase()
    if (lower.includes('not found') || stderr.includes('HTTP 404')) {
      return { type: 'not_found', message: stderr }
    }
    if (lower.includes('rate limit')) {
      return { type: 'rate_limited', message: stderr }
    }
    return { type: 'unknown', message: stderr }
  },
  parseGitHubOwnerRepo: (remoteUrl: string) => {
    const match = remoteUrl.trim().match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/)
    return match ? { owner: match[1], repo: match[2] } : null
  },
  acquire: acquireMock,
  release: releaseMock,
  _resetOwnerRepoCache: vi.fn()
}))

vi.mock('../git/runner', () => ({
  gitExecFileAsync: gitExecFileAsyncMock
}))

vi.mock('../providers/ssh-git-dispatch', () => ({
  getSshGitProvider: getSshGitProviderMock
}))

vi.mock('./local-git-config-signature', () => ({
  readLocalGitConfigSignature: readLocalGitConfigSignatureMock
}))

vi.mock('./rate-limit', () => ({
  getRateLimit: getRateLimitMock,
  rateLimitGuard: rateLimitGuardMock,
  noteRateLimitSpend: noteRateLimitSpendMock
}))

import {
  getPRForBranch,
  getPRForBranchOutcome,
  _resetOwnerRepoCache,
  _resetMergeQueueCacheForTests,
  __resetTrackedUpstreamBranchCacheForTests
} from './client'
import { __resetPRConflictSummaryCachesForTests } from './conflict-summary'
import { resetMergedPRCommitMembershipCacheForTest } from './merged-pr-commit-membership'

describe('issue #9171: default-branch checkout attaches a stale closed PR', () => {
  beforeEach(() => {
    execFileAsyncMock.mockReset()
    ghExecFileAsyncMock.mockReset()
    getOwnerRepoMock.mockReset()
    getIssueOwnerRepoMock.mockReset()
    getOwnerRepoForRemoteMock.mockReset()
    resolvePRRepositoryCandidatesMock.mockReset()
    resolvePRRepositoryCandidatesMock.mockImplementation(async (repoPath, connectionId) => {
      const origin = await getOwnerRepoMock(repoPath, connectionId)
      return { candidates: origin ? [origin] : [], headRepo: origin }
    })
    getRemoteUrlForRepoMock.mockReset()
    gitExecFileAsyncMock.mockReset()
    getRateLimitMock.mockReset()
    getRateLimitMock.mockResolvedValue({ resources: {} })
    rateLimitGuardMock.mockReset()
    rateLimitGuardMock.mockReturnValue({ blocked: false })
    noteRateLimitSpendMock.mockReset()
    ghRepoExecOptionsMock.mockClear()
    githubRepoContextMock.mockClear()
    getSshGitProviderMock.mockReset()
    readLocalGitConfigSignatureMock.mockReset()
    readLocalGitConfigSignatureMock.mockResolvedValue(undefined)
    acquireMock.mockReset()
    releaseMock.mockReset()
    acquireMock.mockResolvedValue(undefined)
    _resetOwnerRepoCache()
    _resetMergeQueueCacheForTests()
    __resetTrackedUpstreamBranchCacheForTests()
    __resetPRConflictSummaryCachesForTests()
    resetMergedPRCommitMembershipCacheForTest()
  })

  it('BUG: returns a stale CLOSED PR when checked out on the default branch (master)', async () => {
    getOwnerRepoMock.mockResolvedValueOnce({ owner: 'acme', repo: 'widgets' })
    // The only PR whose HEAD ref is `master`: a long-closed one opened by mistake.
    ghExecFileAsyncMock.mockResolvedValueOnce({
      stdout: JSON.stringify([
        {
          number: 7,
          title: 'Accidental PR from master',
          state: 'closed',
          merged_at: null,
          html_url: 'https://github.com/acme/widgets/pull/7',
          updated_at: '2024-01-01T00:00:00Z',
          draft: false,
          mergeable: null,
          base: { ref: 'old-release', sha: 'base-oid' },
          head: { ref: 'master', sha: 'stale-master-oid' }
        }
      ])
    })

    // `master` is the repository's default branch here.
    const pr = await getPRForBranch('/repo-root', 'master')

    // Orca issues a head-branch lookup for the default branch itself, with
    // state=all — so it sees the historical closed PR.
    expect(ghExecFileAsyncMock).toHaveBeenCalledWith(
      ['api', 'repos/acme/widgets/pulls?head=acme%3Amaster&state=all&per_page=1'],
      { cwd: '/repo-root' }
    )

    // BUG (#9171): the stale closed PR #7 is attached to the default-branch
    // checkout, so the UI shows its wrong diffs/checks.
    // CORRECT: on the default branch Orca should attach NO PR (expect(pr).toBeNull()).
    expect(pr).not.toBeNull()
    expect(pr?.number).toBe(7)
    expect(pr?.state).toBe('closed')
    expect(pr?.headRefName).toBe('master')
  })

  it('BUG: getPRForBranchOutcome reports kind="found" for the default branch', async () => {
    getOwnerRepoMock.mockResolvedValueOnce({ owner: 'acme', repo: 'widgets' })
    ghExecFileAsyncMock.mockResolvedValueOnce({
      stdout: JSON.stringify([
        {
          number: 7,
          title: 'Accidental PR from master',
          state: 'closed',
          merged_at: null,
          html_url: 'https://github.com/acme/widgets/pull/7',
          updated_at: '2024-01-01T00:00:00Z',
          draft: false,
          mergeable: null,
          base: { ref: 'old-release', sha: 'base-oid' },
          head: { ref: 'master', sha: 'stale-master-oid' }
        }
      ])
    })

    const outcome = await getPRForBranchOutcome('/repo-root', 'master')

    // BUG (#9171): outcome is "found" for a default-branch checkout.
    // CORRECT: outcome.kind should be 'no-pr'.
    expect(outcome.kind).toBe('found')
  })
})

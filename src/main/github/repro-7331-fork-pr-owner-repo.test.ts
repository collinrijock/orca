import { beforeEach, describe, expect, it, vi } from 'vitest'

// Repro for issue #7331: PR details fail to load for fork repositories because
// getOwnerRepo() (the PR-lookup resolver) only consults the `origin` remote,
// while getIssueOwnerRepo() consults `upstream` first. On a fork checkout
// (origin -> fork, upstream -> parent) the PR resolver targets the fork, so
// `gh pr view <N> --repo <fork>` fails with "Could not resolve to a PullRequest".

const { gitExecFileAsyncMock, readLocalGitConfigSignatureMock } = vi.hoisted(() => ({
  gitExecFileAsyncMock: vi.fn(),
  readLocalGitConfigSignatureMock: vi.fn(async () => 'sig')
}))

vi.mock('../git/runner', () => ({
  gitExecFileAsync: gitExecFileAsyncMock
}))

vi.mock('../providers/ssh-git-dispatch', () => ({
  getSshGitProvider: () => null
}))

vi.mock('./local-git-config-signature', () => ({
  readLocalGitConfigSignature: readLocalGitConfigSignatureMock
}))

import { getOwnerRepo, getIssueOwnerRepo, _resetOwnerRepoCache } from './github-repository-identity'

const REPO_PATH = '/tmp/fork-checkout'

// A classic fork checkout: origin is the personal fork, upstream is the parent.
const REMOTE_URLS: Record<string, string> = {
  origin: 'https://github.com/fsdwen/orca.git',
  upstream: 'https://github.com/stablyai/orca.git'
}

beforeEach(() => {
  _resetOwnerRepoCache()
  gitExecFileAsyncMock.mockReset()
  gitExecFileAsyncMock.mockImplementation(async (args: string[]) => {
    // getRemoteUrlForRepo calls: ['remote', 'get-url', <remoteName>]
    const remoteName = args[2]
    const url = REMOTE_URLS[remoteName]
    if (!url) {
      const err = new Error(`fatal: No such remote '${remoteName}'`) as Error & { code?: number }
      err.code = 128
      throw err
    }
    return { stdout: url }
  })
})

describe('issue #7331: fork PR owner/repo resolution', () => {
  it('BUG: getOwnerRepo (PR lookup) targets the fork origin, not the parent', async () => {
    const prRepo = await getOwnerRepo(REPO_PATH)

    // This assertion PINS THE BUG: the PR resolver picks the fork, so the
    // subsequent `gh pr view <N> --repo fsdwen/orca` call cannot find the PR
    // (PRs live on the parent stablyai/orca). Correct behavior would resolve
    // to { owner: 'stablyai', repo: 'orca' } like getIssueOwnerRepo does.
    expect(prRepo).toEqual({ owner: 'fsdwen', repo: 'orca' })
  })

  it('CONTRAST: getIssueOwnerRepo correctly prefers the upstream parent', async () => {
    const issueRepo = await getIssueOwnerRepo(REPO_PATH)

    // The issue resolver already checks `upstream` first, so it points at the
    // parent repo where the issues/PRs actually live. This is the behavior the
    // PR resolver should match.
    expect(issueRepo).toEqual({ owner: 'stablyai', repo: 'orca' })
  })

  it('DISCREPANCY: the two resolvers disagree on a fork checkout', async () => {
    const prRepo = await getOwnerRepo(REPO_PATH)
    const issueRepo = await getIssueOwnerRepo(REPO_PATH)

    // The two resolvers return DIFFERENT repos for the same checkout — the exact
    // divergence #7331 reports. When they agree (post-fix), this test would need
    // updating.
    expect(prRepo).not.toEqual(issueRepo)
  })
})

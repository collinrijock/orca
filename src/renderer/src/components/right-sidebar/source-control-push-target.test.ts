import { describe, expect, it } from 'vitest'
import {
  canApplyResolvedSourceControlPushTarget,
  getSourceControlPushTargetResolutionKey,
  shouldRequireResolvedSourceControlPushTarget
} from './source-control-push-target'

describe('source control push target resolution', () => {
  it('requires recovered push targets for linked GitHub PRs and GitLab MRs', () => {
    expect(
      shouldRequireResolvedSourceControlPushTarget({
        linkedGitHubPR: 123
      })
    ).toBe(true)
    expect(getSourceControlPushTargetResolutionKey({ linkedGitHubPR: 123 })).toBe('github:123')

    expect(
      shouldRequireResolvedSourceControlPushTarget({
        linkedGitLabMR: 456
      })
    ).toBe(true)
    expect(getSourceControlPushTargetResolutionKey({ linkedGitLabMR: 456 })).toBe('gitlab:456')
  })

  it('does not strand linked providers that do not expose recovery metadata here', () => {
    for (const metadata of [
      { linkedBitbucketPR: 11 },
      { linkedAzureDevOpsPR: 22 },
      { linkedGiteaPR: 33 }
    ]) {
      expect(shouldRequireResolvedSourceControlPushTarget(metadata)).toBe(false)
      expect(getSourceControlPushTargetResolutionKey(metadata)).toBeNull()
    }
  })

  it('only applies a recovered target while the matching review is still linked', () => {
    expect(
      canApplyResolvedSourceControlPushTarget({
        worktree: { linkedPR: 123, linkedGitLabMR: null, pushTarget: undefined },
        metadata: { linkedGitHubPR: 123 }
      })
    ).toBe(true)
    expect(
      canApplyResolvedSourceControlPushTarget({
        worktree: { linkedPR: 123, linkedGitLabMR: null, pushTarget: undefined },
        metadata: { linkedGitHubPR: 124 }
      })
    ).toBe(false)
    expect(
      canApplyResolvedSourceControlPushTarget({
        worktree: { linkedPR: null, linkedGitLabMR: 456, pushTarget: undefined },
        metadata: { linkedGitLabMR: 456 }
      })
    ).toBe(true)
    expect(
      canApplyResolvedSourceControlPushTarget({
        worktree: {
          linkedPR: null,
          linkedGitLabMR: 456,
          pushTarget: { remoteName: 'fork', branchName: 'feature' }
        },
        metadata: { linkedGitLabMR: 456 }
      })
    ).toBe(false)
  })
})

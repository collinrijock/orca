import { callRuntimeRpc, getActiveRuntimeTarget } from '@/runtime/runtime-rpc-client'
import { resolveGitHubPrStartPointForRepo } from '@/lib/github-pr-start-point'
import type { GitPushTarget, GlobalSettings, Worktree } from '../../../../shared/types'

type SourceControlPushTargetSettings =
  | Pick<GlobalSettings, 'activeRuntimeEnvironmentId'>
  | null
  | undefined

type SourceControlPushTargetMetadata = {
  linkedGitHubPR?: number | null
  linkedGitLabMR?: number | null
  linkedBitbucketPR?: number | null
  linkedAzureDevOpsPR?: number | null
  linkedGiteaPR?: number | null
}

type PushTargetSource =
  | { provider: 'github'; number: number }
  | { provider: 'gitlab'; number: number }

function finiteProviderNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function getPushTargetSource(metadata: SourceControlPushTargetMetadata): PushTargetSource | null {
  const githubNumber = finiteProviderNumber(metadata.linkedGitHubPR)
  if (githubNumber !== null) {
    return { provider: 'github', number: githubNumber }
  }
  const gitlabNumber = finiteProviderNumber(metadata.linkedGitLabMR)
  if (gitlabNumber !== null) {
    return { provider: 'gitlab', number: gitlabNumber }
  }
  return null
}

export function getSourceControlPushTargetResolutionKey(
  metadata: SourceControlPushTargetMetadata
): string | null {
  const source = getPushTargetSource(metadata)
  return source ? `${source.provider}:${source.number}` : null
}

export function shouldRequireResolvedSourceControlPushTarget(
  metadata: SourceControlPushTargetMetadata
): boolean {
  // Why: only GitHub/GitLab currently expose enough data here to recover a
  // missing push target; unsupported providers must not be stranded forever.
  return getPushTargetSource(metadata) !== null
}

export function canApplyResolvedSourceControlPushTarget(args: {
  worktree: Pick<Worktree, 'linkedPR' | 'linkedGitLabMR' | 'pushTarget'> | null | undefined
  metadata: SourceControlPushTargetMetadata
}): boolean {
  const source = getPushTargetSource(args.metadata)
  if (!args.worktree || args.worktree.pushTarget || !source) {
    return false
  }
  return source.provider === 'github'
    ? args.worktree.linkedPR === source.number
    : args.worktree.linkedGitLabMR === source.number
}

export async function resolveSourceControlPushTarget(args: {
  repoId: string
  settings: SourceControlPushTargetSettings
  metadata: SourceControlPushTargetMetadata
}): Promise<GitPushTarget | undefined> {
  const source = getPushTargetSource(args.metadata)
  if (!source) {
    return undefined
  }
  if (source.provider === 'github') {
    const result = await resolveGitHubPrStartPointForRepo({
      repoId: args.repoId,
      prNumber: source.number,
      settings: args.settings
    })
    return result.pushTarget
  }

  const target = getActiveRuntimeTarget(args.settings)
  const result =
    target.kind === 'local'
      ? await window.api.worktrees.resolveMrBase({
          repoId: args.repoId,
          mrIid: source.number
        })
      : await callRuntimeRpc<
          | { baseBranch: string; compareBaseRef?: string; pushTarget?: GitPushTarget }
          | { error: string }
        >(
          target,
          'worktree.resolveMrBase',
          {
            repo: args.repoId,
            mrIid: source.number
          },
          { timeoutMs: 30_000 }
        )
  if ('error' in result) {
    throw new Error(result.error)
  }
  return result.pushTarget
}

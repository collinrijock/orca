import type { CheckStatus, PRConflictSummary, PRMergeableState } from './types'

export type HostedReviewProvider = 'github' | 'gitlab' | 'bitbucket' | 'gitea' | 'unsupported'

export type HostedReviewState = 'open' | 'closed' | 'merged' | 'draft'

export type HostedReviewInfo = {
  provider: HostedReviewProvider
  number: number
  title: string
  state: HostedReviewState
  url: string
  status: CheckStatus
  updatedAt: string
  mergeable: PRMergeableState
  headSha?: string
  conflictSummary?: PRConflictSummary
}

export type HostedReviewForBranchArgs = {
  repoPath: string
  repoId?: string
  branch: string
  linkedGitHubPR?: number | null
  linkedGitLabMR?: number | null
  linkedBitbucketPR?: number | null
  linkedGiteaPR?: number | null
}

export type HostedReviewSummary = {
  number?: number
  url: string
}

export type CreateHostedReviewInput = {
  provider: HostedReviewProvider
  base: string
  head?: string
  title: string
  body?: string
  draft?: boolean
}

export type CreateHostedReviewArgs = CreateHostedReviewInput & {
  repoPath: string
  connectionId?: string | null
}

export type CreateHostedReviewErrorCode =
  | 'auth_required'
  | 'unsupported_provider'
  | 'already_exists'
  | 'validation'
  | 'timeout'
  | 'unknown_completion'
  | 'push_failed'
  | 'unknown'

export type CreateHostedReviewResult =
  | { ok: true; number: number; url: string }
  | {
      ok: false
      code: CreateHostedReviewErrorCode
      error: string
      existingReview?: HostedReviewSummary
    }

export type HostedReviewCreationBlockedReason =
  | 'dirty'
  | 'detached_head'
  | 'default_branch'
  | 'no_upstream'
  | 'needs_push'
  | 'needs_sync'
  | 'auth_required'
  | 'fork_head_unsupported'
  | 'unsupported_provider'
  | 'existing_review'
  | null

export type HostedReviewCreationNextAction =
  | 'commit'
  | 'publish'
  | 'push'
  | 'sync'
  | 'authenticate'
  | 'open_existing_review'
  | null

export type HostedReviewCreationEligibility = {
  provider: HostedReviewProvider
  review: HostedReviewSummary | null
  canCreate: boolean
  blockedReason: HostedReviewCreationBlockedReason
  nextAction: HostedReviewCreationNextAction
  defaultBaseRef?: string | null
  head?: string | null
  title?: string | null
  body?: string | null
}

export type HostedReviewCreationEligibilityArgs = {
  repoPath: string
  connectionId?: string | null
  branch: string
  base?: string | null
  hasUncommittedChanges?: boolean
  hasUpstream?: boolean
  ahead?: number
  behind?: number
  linkedGitHubPR?: number | null
  linkedGitLabMR?: number | null
  linkedBitbucketPR?: number | null
  linkedGiteaPR?: number | null
}

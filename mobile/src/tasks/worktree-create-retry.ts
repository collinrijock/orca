import type { RpcClient } from '../transport/rpc-client'
import type { RpcSuccess } from '../transport/types'
import {
  CLIENT_WORKTREE_CREATE_MAX_ATTEMPTS,
  getClientWorktreeCreateCandidate,
  isRetryableWorktreeCreateConflict
} from '../../../src/shared/new-workspace/worktree-create-retry-policy'
import type {
  AgentLaunchFailureCode,
  AgentLaunchRequestError
} from '../../../src/shared/agent-launch-contract'
import { WORKTREE_CREATE_TIMEOUT_MS } from './workspace-create-timeout'

// Why: server-side collision checks (branch already exists locally / on a remote
// / already has PR #N) can fire even after a pre-flight basename dedupe —
// branches outlive worktrees in git, and remote branches/PRs aren't visible from
// worktree.ps. Retry by appending -2, -3, ... mirroring the desktop createWorktree
// loop in src/renderer/src/store/slices/worktrees.ts.
export type WorktreeCreateResult = { worktreeId: string; name: string } | { error: string }

// worktree.create's RPC-success envelope is a union: the created arm carries
// `worktree`, while a pre-create agent-launch rejection (tombstoned/disabled
// custom agent, capacity, etc.) is `{ created: false, agentLaunchResult }` with
// no worktree at all — see NotCreatedWorktreeResult in src/shared/types.ts.
type WorktreeCreateSuccess = { worktree: { id: string } }
type WorktreeCreateRejection = {
  agentLaunchResult:
    | { status: 'failed'; failure: { code: AgentLaunchFailureCode } }
    | { status: 'rejected'; requestError: AgentLaunchRequestError }
}

function isWorktreeCreateRejection(
  result: WorktreeCreateSuccess | WorktreeCreateRejection
): result is WorktreeCreateRejection {
  return !('worktree' in result)
}

// Maps the typed pre-create rejection to a user-facing message, mirroring how
// the mobile vault-resume family (ai-vault-resume-outcome.ts) reads a typed
// outcome instead of assuming the success shape.
function describeWorktreeCreateRejection(rejection: WorktreeCreateRejection): string {
  if (rejection.agentLaunchResult.status === 'failed') {
    return `Couldn't start the agent (${rejection.agentLaunchResult.failure.code}).`
  }
  return `Couldn't create the workspace (${rejection.agentLaunchResult.requestError.code}).`
}

// Creates a worktree, retrying with a numeric suffix on a name-collision error.
// buildParams receives the candidate name so callers can assemble source-specific
// params (linked issue/PR, base branch, etc.) around it. Callers that can't clear
// a collision by re-suffixing (e.g. reusing a fixed existing branch) pass
// maxAttempts: 1 to fail fast instead of burning the full retry budget.
export async function createWorktreeWithNameRetry(args: {
  client: RpcClient
  baseName: string
  buildParams: (name: string) => Record<string, unknown>
  maxAttempts?: number
}): Promise<WorktreeCreateResult> {
  const { client, baseName, buildParams } = args
  const maxAttempts = args.maxAttempts ?? CLIENT_WORKTREE_CREATE_MAX_ATTEMPTS
  let lastError: string | null = null
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidateName = getClientWorktreeCreateCandidate(baseName, attempt)
    const response = await client.sendRequest('worktree.create', buildParams(candidateName), {
      timeoutMs: WORKTREE_CREATE_TIMEOUT_MS
    })
    if (response.ok) {
      const result = (response as RpcSuccess).result as
        | WorktreeCreateSuccess
        | WorktreeCreateRejection
      // A pre-create rejection is not a name collision, so re-suffixing and
      // retrying can never fix it — surface it immediately instead of looping.
      if (isWorktreeCreateRejection(result)) {
        return { error: describeWorktreeCreateRejection(result) }
      }
      return { worktreeId: result.worktree.id, name: candidateName }
    }
    lastError = response.error.message
    if (!isRetryableWorktreeCreateConflict(lastError ?? '')) {
      break
    }
  }
  return { error: lastError ?? 'Failed to create workspace' }
}

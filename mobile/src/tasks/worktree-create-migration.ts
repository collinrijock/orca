import * as ExpoCrypto from 'expo-crypto'
import { isRetryableWorktreeCreateConflict } from '../../../src/shared/new-workspace/worktree-create-retry-policy'
import { LogicalClientCutoverError } from '../transport/stable-logical-rpc-client'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'

export const WORKTREE_CREATE_MIGRATION_UNCERTAIN_ERROR =
  'Connection changed while this workspace was being created. It may already exist—refresh the workspace list before trying again.'

class WorktreeCreateMigrationUncertainError extends Error {
  constructor() {
    super(WORKTREE_CREATE_MIGRATION_UNCERTAIN_ERROR)
  }
}

export async function sendMigrationSafeWorktreeCreate(args: {
  client: RpcClient
  params: Record<string, unknown>
  timeoutMs: number
  clientMutationId?: string
}): Promise<RpcResponse> {
  const requestParams = {
    ...args.params,
    clientMutationId: args.clientMutationId ?? ExpoCrypto.randomUUID()
  }
  const send = (): Promise<RpcResponse> =>
    args.client.sendRequest('worktree.create', requestParams, { timeoutMs: args.timeoutMs })

  try {
    return await send()
  } catch (error) {
    if (!(error instanceof LogicalClientCutoverError)) {
      throw error
    }
  }

  try {
    const response = await send()
    // Why: old desktops ignore the operation ID. A same-name collision after
    // cutover can mean the first request committed, so suffixing could duplicate it.
    if (!response.ok && isRetryableWorktreeCreateConflict(response.error.message)) {
      throw new WorktreeCreateMigrationUncertainError()
    }
    return response
  } catch (error) {
    if (error instanceof WorktreeCreateMigrationUncertainError) {
      throw error
    }
    throw new WorktreeCreateMigrationUncertainError()
  }
}

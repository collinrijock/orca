import type { RuntimeWorkspaceListModelResult } from '../../../src/shared/runtime-types'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse, RpcSuccess } from '../transport/types'

export type WorkspaceListModelSnapshot = {
  worktreesResponse: RpcResponse
  workspaceListModel: RuntimeWorkspaceListModelResult | null
}

export async function fetchWorkspaceListModelSnapshot(
  client: RpcClient
): Promise<WorkspaceListModelSnapshot> {
  const [worktreesResponse, listModelResponse] = await Promise.all([
    client.sendRequest('worktree.ps', { limit: 10000 }),
    client.sendRequest('worktree.listModel', { limit: 10000 }).catch(() => null)
  ])
  return {
    worktreesResponse,
    workspaceListModel: listModelResponse?.ok
      ? ((listModelResponse as RpcSuccess).result as RuntimeWorkspaceListModelResult)
      : null
  }
}

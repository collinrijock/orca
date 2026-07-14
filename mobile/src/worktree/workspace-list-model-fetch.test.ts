import { describe, expect, it } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { fetchWorkspaceListModelSnapshot } from './workspace-list-model-fetch'

const META = { _meta: { runtimeId: 'r1' } }

function success(result: unknown): RpcResponse {
  return { id: '1', ok: true, result, ...META }
}

function failure(code: string): RpcResponse {
  return { id: '1', ok: false, error: { code, message: code }, ...META }
}

// Only sendRequest is exercised; the rest of RpcClient is irrelevant here.
function clientWith(handlers: Record<string, () => Promise<RpcResponse>>): RpcClient {
  return {
    sendRequest: (method: string) => {
      const handler = handlers[method]
      if (!handler) {
        throw new Error(`unexpected method ${method}`)
      }
      return handler()
    }
  } as unknown as RpcClient
}

describe('fetchWorkspaceListModelSnapshot', () => {
  it('returns the model when worktree.listModel succeeds', async () => {
    const model = { rows: [], generatedAt: 1 }
    const snapshot = await fetchWorkspaceListModelSnapshot(
      clientWith({
        'worktree.ps': () => Promise.resolve(success({ worktrees: [] })),
        'worktree.listModel': () => Promise.resolve(success(model))
      })
    )
    expect(snapshot.workspaceListModel).toEqual(model)
    expect(snapshot.worktreesResponse.ok).toBe(true)
  })

  it('falls back to null when worktree.listModel returns ok:false (e.g. invalid_limit)', async () => {
    const snapshot = await fetchWorkspaceListModelSnapshot(
      clientWith({
        'worktree.ps': () => Promise.resolve(success({ worktrees: [] })),
        'worktree.listModel': () => Promise.resolve(failure('invalid_limit'))
      })
    )
    expect(snapshot.workspaceListModel).toBeNull()
    // worktree.ps must still resolve so the UI keeps rendering the ps-derived list.
    expect(snapshot.worktreesResponse.ok).toBe(true)
  })

  it('falls back to null when worktree.listModel rejects (old host / relay drop)', async () => {
    const snapshot = await fetchWorkspaceListModelSnapshot(
      clientWith({
        'worktree.ps': () => Promise.resolve(success({ worktrees: [] })),
        'worktree.listModel': () => Promise.reject(new Error('method not found'))
      })
    )
    expect(snapshot.workspaceListModel).toBeNull()
    expect(snapshot.worktreesResponse.ok).toBe(true)
  })
})

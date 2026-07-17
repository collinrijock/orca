import { describe, expect, it } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { createWorktreeWithNameRetry } from './worktree-create-retry'

type Call = { method: string; params: Record<string, unknown> }

function fakeClient(handle: (method: string, call: number) => unknown, calls: Call[]): RpcClient {
  return {
    sendRequest: async (method: string, params?: unknown) => {
      calls.push({ method, params: (params ?? {}) as Record<string, unknown> })
      const result = handle(method, calls.length)
      if (result instanceof Error) {
        return {
          id: '1',
          ok: false,
          error: { code: 'x', message: result.message },
          _meta: { runtimeId: 'r' }
        }
      }
      return { id: '1', ok: true, result, _meta: { runtimeId: 'r' } }
    }
  } as unknown as RpcClient
}

describe('createWorktreeWithNameRetry', () => {
  it('returns the worktree id on the created arm', async () => {
    const calls: Call[] = []
    const client = fakeClient(() => ({ worktree: { id: 'wt-1' } }), calls)
    const result = await createWorktreeWithNameRetry({
      client,
      baseName: 'feature',
      buildParams: (name) => ({ name })
    })
    expect(result).toEqual({ worktreeId: 'wt-1', name: 'feature' })
  })

  // Regression for L4-M3: a pre-create agent-launch rejection (tombstoned/
  // disabled custom agent, capacity exceeded, ...) is an RPC success with
  // `created: false` and no `worktree` key. Reading `.worktree.id`
  // unconditionally threw a TypeError instead of surfacing the failure.
  it('surfaces a failed agentLaunchResult without throwing, and does not retry', async () => {
    const calls: Call[] = []
    const client = fakeClient(
      () => ({
        created: false,
        agentLaunchResult: { status: 'failed', failure: { code: 'custom_agent_disabled' } }
      }),
      calls
    )
    const result = await createWorktreeWithNameRetry({
      client,
      baseName: 'feature',
      buildParams: (name) => ({ name })
    })
    expect(result).toEqual({ error: "Couldn't start the agent (custom_agent_disabled)." })
    expect(calls).toHaveLength(1)
  })

  it('surfaces a rejected agentLaunchResult without throwing, and does not retry', async () => {
    const calls: Call[] = []
    const client = fakeClient(
      () => ({
        created: false,
        agentLaunchResult: { status: 'rejected', requestError: { code: 'untrusted_reference' } }
      }),
      calls
    )
    const result = await createWorktreeWithNameRetry({
      client,
      baseName: 'feature',
      buildParams: (name) => ({ name })
    })
    expect(result).toEqual({ error: "Couldn't create the workspace (untrusted_reference)." })
    expect(calls).toHaveLength(1)
  })

  it('retries on a retryable name-collision error', async () => {
    const calls: Call[] = []
    const client = fakeClient(
      (_method, call) =>
        call === 1 ? new Error('Branch already exists locally') : { worktree: { id: 'wt-2' } },
      calls
    )
    const result = await createWorktreeWithNameRetry({
      client,
      baseName: 'feature',
      buildParams: (name) => ({ name })
    })
    expect(result).toEqual({ worktreeId: 'wt-2', name: 'feature-2' })
    expect(calls).toHaveLength(2)
  })
})

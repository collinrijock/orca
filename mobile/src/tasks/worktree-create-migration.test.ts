import { describe, expect, it, vi } from 'vitest'
import * as ExpoCrypto from 'expo-crypto'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { LogicalClientCutoverError } from '../transport/stable-logical-rpc-client'
import { createWorktreeWithNameRetry } from './worktree-create-retry'
import {
  sendMigrationSafeWorktreeCreate,
  WORKTREE_CREATE_MIGRATION_UNCERTAIN_ERROR
} from './worktree-create-migration'

vi.mock('expo-crypto', () => ({
  randomUUID: vi.fn(() => '00000000-0000-4000-8000-000000000001')
}))

const success = (worktreeId: string): RpcResponse => ({
  id: 'response',
  ok: true,
  result: { worktree: { id: worktreeId } },
  _meta: { runtimeId: 'runtime' }
})

const failure = (message: string): RpcResponse => ({
  id: 'response',
  ok: false,
  error: { code: 'invalid_argument', message },
  _meta: { runtimeId: 'runtime' }
})

function clientWithSend(sendRequest: RpcClient['sendRequest']): RpcClient {
  return { sendRequest } as RpcClient
}

describe('migration-safe worktree creation', () => {
  it('replays once with the identical candidate and mutation ID after cutover', async () => {
    const sendRequest = vi
      .fn<RpcClient['sendRequest']>()
      .mockRejectedValueOnce(new LogicalClientCutoverError())
      .mockResolvedValueOnce(success('wt-1'))

    const response = await sendMigrationSafeWorktreeCreate({
      client: clientWithSend(sendRequest),
      params: { repo: 'repo-1', name: 'migration-safe' },
      timeoutMs: 100,
      clientMutationId: '1cd77fbf-d9d0-4723-9a65-a9064d93f582'
    })

    expect(response).toEqual(success('wt-1'))
    expect(sendRequest).toHaveBeenCalledTimes(2)
    expect(sendRequest.mock.calls[0]?.[1]).toEqual(sendRequest.mock.calls[1]?.[1])
    expect(sendRequest.mock.calls[1]?.[1]).toEqual({
      repo: 'repo-1',
      name: 'migration-safe',
      clientMutationId: '1cd77fbf-d9d0-4723-9a65-a9064d93f582'
    })
  })

  it('turns an old-desktop collision after cutover into actionable uncertainty', async () => {
    const sendRequest = vi
      .fn<RpcClient['sendRequest']>()
      .mockRejectedValueOnce(new LogicalClientCutoverError())
      .mockResolvedValueOnce(failure('Branch "migration-safe" already exists.'))

    await expect(
      sendMigrationSafeWorktreeCreate({
        client: clientWithSend(sendRequest),
        params: { repo: 'repo-1', name: 'migration-safe' },
        timeoutMs: 100,
        clientMutationId: '9ea97e27-4f66-4ca3-ae8a-e11c1f10990b'
      })
    ).rejects.toThrow(WORKTREE_CREATE_MIGRATION_UNCERTAIN_ERROR)
    expect(sendRequest).toHaveBeenCalledTimes(2)
  })

  it('does not suffix after a second interrupted migration', async () => {
    const sendRequest = vi
      .fn<RpcClient['sendRequest']>()
      .mockRejectedValue(new LogicalClientCutoverError())

    await expect(
      createWorktreeWithNameRetry({
        client: clientWithSend(sendRequest),
        baseName: 'migration-safe',
        buildParams: (name) => ({ repo: 'repo-1', name })
      })
    ).rejects.toThrow(WORKTREE_CREATE_MIGRATION_UNCERTAIN_ERROR)
    expect(sendRequest).toHaveBeenCalledTimes(2)
    expect(sendRequest.mock.calls.map((call) => (call[1] as { name: string }).name)).toEqual([
      'migration-safe',
      'migration-safe'
    ])
  })

  it('still suffixes an ordinary non-migration collision with a fresh mutation ID', async () => {
    const sendRequest = vi
      .fn<RpcClient['sendRequest']>()
      .mockResolvedValueOnce(failure('Branch "octopus" already exists.'))
      .mockResolvedValueOnce(success('wt-2'))
    const mutationIds = [
      '4203a4ad-f6df-4260-b40d-5e4d59c5e254',
      '8d292184-d3c3-42a3-9fd5-294fe4e2d15f'
    ]
    vi.mocked(ExpoCrypto.randomUUID).mockImplementation(() => mutationIds.shift()!)

    await expect(
      createWorktreeWithNameRetry({
        client: clientWithSend(sendRequest),
        baseName: 'octopus',
        buildParams: (name) => ({ repo: 'repo-1', name })
      })
    ).resolves.toEqual({ worktreeId: 'wt-2', name: 'octopus-2' })
    expect(sendRequest.mock.calls.map((call) => call[1])).toEqual([
      {
        repo: 'repo-1',
        name: 'octopus',
        clientMutationId: '4203a4ad-f6df-4260-b40d-5e4d59c5e254'
      },
      {
        repo: 'repo-1',
        name: 'octopus-2',
        clientMutationId: '8d292184-d3c3-42a3-9fd5-294fe4e2d15f'
      }
    ])
  })
})

import { describe, expect, it, vi } from 'vitest'
import { runIdempotentWorktreeCreate } from './worktree-create-idempotency'

describe('worktree.create idempotency', () => {
  it('shares concurrent and settled-success replays for one runtime', async () => {
    const runtime = {}
    let resolveCreate!: (value: { worktree: { id: string } }) => void
    const create = vi.fn(
      () =>
        new Promise<{ worktree: { id: string } }>((resolve) => {
          resolveCreate = resolve
        })
    )
    const args = {
      runtime,
      clientMutationId: '12bf2c0f-49d9-46c9-9005-c231715c53ad',
      params: { repo: 'repo-1', name: 'migration-safe' },
      create
    }

    const first = runIdempotentWorktreeCreate(args)
    const concurrent = runIdempotentWorktreeCreate(args)
    await Promise.resolve()
    expect(create).toHaveBeenCalledTimes(1)

    const created = { worktree: { id: 'wt-1' } }
    resolveCreate(created)
    await expect(Promise.all([first, concurrent])).resolves.toEqual([created, created])
    await expect(runIdempotentWorktreeCreate(args)).resolves.toBe(created)
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('rejects reuse of a mutation ID with different parameters', async () => {
    const runtime = {}
    const clientMutationId = 'fdb51f1b-39dc-4fb4-8e36-8017b3ec1639'
    await runIdempotentWorktreeCreate({
      runtime,
      clientMutationId,
      params: { repo: 'repo-1', name: 'first' },
      create: async () => ({ worktree: { id: 'wt-1' } })
    })

    await expect(
      runIdempotentWorktreeCreate({
        runtime,
        clientMutationId,
        params: { repo: 'repo-1', name: 'second' },
        create: async () => ({ worktree: { id: 'wt-2' } })
      })
    ).rejects.toThrow('cannot be reused with different')
  })

  it('drops failures so the same operation can retry', async () => {
    const runtime = {}
    const create = vi
      .fn<() => Promise<{ worktree: { id: string } }>>()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce({ worktree: { id: 'wt-retried' } })
    const args = {
      runtime,
      clientMutationId: '6cb64ce3-eaac-496c-a5e6-2c395c12252a',
      params: { repo: 'repo-1', name: 'retryable' },
      create
    }

    await expect(runIdempotentWorktreeCreate(args)).rejects.toThrow('temporary failure')
    await expect(runIdempotentWorktreeCreate(args)).resolves.toEqual({
      worktree: { id: 'wt-retried' }
    })
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('does not share mutation IDs across runtimes', async () => {
    const create = vi.fn(async () => ({ worktree: { id: 'wt-1' } }))
    const request = {
      clientMutationId: '0fab3dbf-16b8-4588-a1e5-81e931415e4c',
      params: { repo: 'repo-1', name: 'isolated' },
      create
    }

    await runIdempotentWorktreeCreate({ ...request, runtime: {} })
    await runIdempotentWorktreeCreate({ ...request, runtime: {} })
    expect(create).toHaveBeenCalledTimes(2)
  })
})

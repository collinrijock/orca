import { describe, expect, it, vi } from 'vitest'
import { createTestStore, makeWorktree } from './store-test-helpers'
import {
  ephemeralVmCleanup,
  ephemeralVmListRuntimes,
  installReposRuntimeRoutingHarness,
  reposRemove,
  sshRepo
} from './repos-runtime-routing-fixture'

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn()
  }
}))

installReposRuntimeRoutingHarness()

describe('runtime-owned project VM removal', () => {
  it('retains the SSH project when VM cleanup fails', async () => {
    const runtimeOwnedRepo = {
      ...sshRepo,
      id: 'runtime-repo',
      connectionId: 'runtime-ssh-orca-1'
    }
    const worktreeId = `${runtimeOwnedRepo.id}::/runtime/wt`
    ephemeralVmListRuntimes.mockResolvedValue([
      {
        id: 'runtime-1',
        workspaceId: worktreeId,
        sshTargetId: runtimeOwnedRepo.connectionId,
        cleanupStatus: 'not_started'
      }
    ])
    ephemeralVmCleanup.mockRejectedValue(new Error('VM cleanup unavailable'))
    const store = createTestStore()
    store.setState({
      repos: [runtimeOwnedRepo],
      worktreesByRepo: {
        [runtimeOwnedRepo.id]: [makeWorktree({ id: worktreeId, repoId: runtimeOwnedRepo.id })]
      }
    })

    await store.getState().removeProject(runtimeOwnedRepo.id)

    expect(store.getState().repos).toEqual([runtimeOwnedRepo])
    expect(reposRemove).not.toHaveBeenCalled()
  })
})

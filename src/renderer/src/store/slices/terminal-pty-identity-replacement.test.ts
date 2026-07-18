import { describe, expect, it } from 'vitest'
import { createTestStore, makeTab, seedStore } from './store-test-helpers'

describe('terminal PTY identity replacement', () => {
  it('keeps repeated remote handle rotations bounded to the live identity', () => {
    const store = createTestStore()
    const worktreeId = 'repo1::/path/wt1'
    const firstPtyId = 'remote:env-1@@terminal-1'
    const secondPtyId = 'remote:env-1@@terminal-2'
    const thirdPtyId = 'remote:env-1@@terminal-3'
    seedStore(store, {
      tabsByWorktree: {
        [worktreeId]: [makeTab({ id: 'tab-1', worktreeId, ptyId: firstPtyId })]
      },
      ptyIdsByTabId: { 'tab-1': [firstPtyId] }
    })

    store.getState().updateTabPtyId('tab-1', secondPtyId, firstPtyId)
    store.getState().updateTabPtyId('tab-1', thirdPtyId, secondPtyId)

    const state = store.getState()
    expect(state.ptyIdsByTabId['tab-1']).toEqual([thirdPtyId])
    expect(state.tabsByWorktree[worktreeId][0]?.ptyId).toBe(thirdPtyId)
    expect(state.lastKnownRelayPtyIdByTabId['tab-1']).toBe(thirdPtyId)
  })
})

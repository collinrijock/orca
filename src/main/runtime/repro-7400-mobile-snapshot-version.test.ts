/**
 * Repro for issue #7400: Orca Mobile can show a stale one-tab session when the
 * main process bumps `mobileSessionTabs.snapshotVersion` for live PTY/title/
 * agent-status churn.
 *
 * The same `snapshotVersion` counter is (mis)used for two different meanings:
 *   1. renderer-owned STRUCTURAL freshness (tabs, groups, order) — a monotonic
 *      counter that lives in the renderer (sync-runtime-graph.ts), and
 *   2. main-owned LIVE freshness — `touchMobileSessionSnapshotsForPty()` bumps
 *      the same field on every PTY/title/status notification without touching
 *      the tab list.
 *
 * `syncMobileSessionTabs()` decides whether to accept a newer renderer
 * structural snapshot by comparing the SAME field:
 *
 *   if (!existing || epoch changed || incoming.snapshotVersion >= existing.snapshotVersion)
 *
 * So once main has bumped a STALE one-tab snapshot's version high (via title
 * churn), a later CORRECT renderer snapshot (same publication epoch, its own
 * lower structural version) that contains BOTH terminals is rejected. Mobile
 * keeps showing one tab even though the desktop has two.
 *
 * This test IMPORTS THE REAL OrcaRuntimeService and drives the real
 * `touchMobileSessionSnapshotsForPty` + `syncMobileSessionTabs` methods. It
 * PASSES on the current tree while asserting the BUGGY outcome (one tab). The
 * assertion marked BUG ENCODES the defect; the CORRECT expectation is noted
 * next to it.
 */
import { describe, expect, it, vi } from 'vitest'
import type {
  RuntimeMobileSessionTabsSnapshot,
  RuntimeMobileSessionTerminalTab
} from '../../shared/runtime-types'
import { OrcaRuntimeService } from './orca-runtime'

vi.mock('../git/worktree', () => ({
  listWorktrees: vi.fn().mockResolvedValue([]),
  listWorktreesStrict: vi.fn().mockResolvedValue([])
}))

vi.mock('../hooks', () => ({
  createSetupRunnerScript: vi.fn(),
  getEffectiveHooks: vi.fn().mockReturnValue(null),
  runHook: vi.fn().mockResolvedValue({ success: true, output: '' })
}))

const store = {
  getRepo: () => ({
    id: 'repo-1',
    path: '/tmp/repo',
    displayName: 'repo',
    badgeColor: 'blue',
    addedAt: 1
  }),
  getRepos: () => [store.getRepo()],
  addRepo: () => {},
  updateRepo: () => undefined as never,
  getAllWorktreeMeta: () => ({}),
  getWorktreeMeta: () => undefined,
  getGitHubCache: () => ({ pr: {}, issue: {} }),
  setWorktreeMeta: () => undefined as never,
  removeWorktreeMeta: () => {},
  getSettings: () => ({
    workspaceDir: '/tmp/workspaces',
    nestWorkspaces: false,
    refreshLocalBaseRefOnWorktreeCreate: false,
    branchPrefix: 'none',
    branchPrefixCustom: ''
  })
  // Intentionally no getWorkspaceSession: keeps the headless-hydrate path in
  // syncMobileSessionTabs a no-op so this test isolates the freshness guard.
}

type RuntimePrivate = {
  mobileSessionTabsByWorktree: Map<string, RuntimeMobileSessionTabsSnapshot>
  touchMobileSessionSnapshotsForPty: (ptyId: string, options?: { immediate?: boolean }) => void
  syncMobileSessionTabs: (snapshots: RuntimeMobileSessionTabsSnapshot[] | undefined) => void
}

const WORKTREE = 'worktree-916abfb4'
const EPOCH = 'renderer:e1a5e432-09e2-4a42-9dfa-b9dab63b73c3'
const PTY_A = 'pty-A'

function terminalTab(
  parentTabId: string,
  leafId: string,
  ptyId: string,
  title: string,
  isActive: boolean
): RuntimeMobileSessionTerminalTab {
  return {
    type: 'terminal',
    id: `${parentTabId}::${leafId}`,
    parentTabId,
    leafId,
    ptyId,
    title,
    isActive
  }
}

function oneTabSnapshot(snapshotVersion: number): RuntimeMobileSessionTabsSnapshot {
  return {
    worktree: WORKTREE,
    publicationEpoch: EPOCH,
    snapshotVersion,
    activeGroupId: 'group-1',
    activeTabId: '60b1bbd2::leaf-a',
    activeTabType: 'terminal',
    tabGroups: [{ id: 'group-1', activeTabId: '60b1bbd2', tabOrder: ['60b1bbd2'] }],
    tabs: [terminalTab('60b1bbd2', 'leaf-a', PTY_A, 'terminal A', true)]
  }
}

function twoTabSnapshot(snapshotVersion: number): RuntimeMobileSessionTabsSnapshot {
  return {
    worktree: WORKTREE,
    publicationEpoch: EPOCH,
    snapshotVersion,
    activeGroupId: 'group-1',
    activeTabId: '60b1bbd2::leaf-a',
    activeTabType: 'terminal',
    tabGroups: [{ id: 'group-1', activeTabId: '60b1bbd2', tabOrder: ['60b1bbd2', 'fe0020e7'] }],
    tabs: [
      terminalTab('60b1bbd2', 'leaf-a', PTY_A, 'terminal A', true),
      // The terminal that goes missing on mobile even though it is live/writable
      // and present in the persisted workspace session.
      terminalTab('fe0020e7', 'leaf-b', 'pty-B', 'terminal B', false)
    ]
  }
}

describe('repro #7400: main-side PTY version bumps reject newer renderer structural snapshot', () => {
  it('keeps a stale one-tab snapshot after main bumps its version above a correct two-tab renderer snapshot', () => {
    const runtime = new OrcaRuntimeService(store)
    const priv = runtime as unknown as RuntimePrivate

    // 1. Renderer published a (temporarily) one-tab structural snapshot, version 6.
    priv.mobileSessionTabsByWorktree.set(WORKTREE, oneTabSnapshot(6))

    // 2. A spinner-in-title / agent-status agent on terminal A churns for a
    //    while. Main bumps the SAME snapshotVersion on every touch without ever
    //    rebuilding the tab list. This models the observed "v keeps climbing,
    //    tabs stays one" behavior from the issue.
    for (let i = 0; i < 100; i++) {
      priv.touchMobileSessionSnapshotsForPty(PTY_A)
    }
    const bumped = priv.mobileSessionTabsByWorktree.get(WORKTREE)
    expect(bumped?.tabs).toHaveLength(1)
    expect(bumped?.snapshotVersion).toBe(106) // 6 + 100 live bumps, still one tab

    // 3. The renderer now publishes its NEXT structural snapshot — same
    //    publication epoch, its own monotonic structural version 7 — containing
    //    BOTH live terminals. This is the correct, fresher structure.
    priv.syncMobileSessionTabs([twoTabSnapshot(7)])

    const stored = priv.mobileSessionTabsByWorktree.get(WORKTREE)

    // BUG (#7400): the correct two-tab snapshot (structural version 7) is
    // REJECTED because the freshness guard compares against the main-bumped
    // version 106 for the same publication epoch. Mobile keeps one tab.
    expect(stored?.tabs).toHaveLength(1)
    expect(stored?.tabs.map((t) => t.parentTabId)).toEqual(['60b1bbd2'])
    expect(stored?.snapshotVersion).toBe(106)

    // CORRECT behavior would be: the newer renderer structural snapshot wins and
    // both terminals become visible. If the guard is fixed, these hold instead:
    //   expect(stored?.tabs).toHaveLength(2)
    //   expect(stored?.tabs.map((t) => t.parentTabId)).toEqual(['60b1bbd2', 'fe0020e7'])
  })

  it('accepts the two-tab snapshot when main has NOT bumped the version (control)', () => {
    const runtime = new OrcaRuntimeService(store)
    const priv = runtime as unknown as RuntimePrivate

    // Same one-tab starting point, but no main-side title churn this time.
    priv.mobileSessionTabsByWorktree.set(WORKTREE, oneTabSnapshot(6))

    // Renderer publishes the two-tab structural snapshot with a higher version.
    priv.syncMobileSessionTabs([twoTabSnapshot(7)])

    const stored = priv.mobileSessionTabsByWorktree.get(WORKTREE)
    // Without the spurious live bumps, the guard accepts the correct snapshot.
    // This isolates the defect to the shared version counter, not the merge.
    expect(stored?.tabs).toHaveLength(2)
    expect(stored?.tabs.map((t) => t.parentTabId)).toEqual(['60b1bbd2', 'fe0020e7'])
  })
})

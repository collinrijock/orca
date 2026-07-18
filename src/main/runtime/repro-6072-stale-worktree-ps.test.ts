/**
 * Repro for issue #6072 — "Mobile keeps showing old agent rows after terminals are closed".
 *
 * This test IMPORTS THE REAL OrcaRuntimeService and drives getWorktreePs() through
 * two stale-state paths reported in the issue:
 *
 *   1. liveTerminalCount stays > 0 because persisted session tabs (tabsByWorktree)
 *      are folded in with `Math.max(liveTerminalCount, tabs.length)` even when no
 *      live PTY/leaf/process backs them.  (orca-runtime.ts getWorktreePs, ~L12325)
 *
 *   2. attachAgentRowsToSummaries() attaches hydrated agent-hook rows (including
 *      `done`) by worktreeId without checking that the pane/tab still exists, so a
 *      finished agent whose tab is closed still shows up in `summary.agents`.
 *      (orca-runtime.ts attachAgentRowsToSummaries, ~L12403)
 *
 * The assertions marked "BUG:" PIN the CURRENT (wrong) behavior — the test passes
 * today. The adjacent "CORRECT would be" comments describe the intended behavior a
 * fix should produce.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { WorkspaceSessionState } from '../../shared/types'
import { getDefaultWorkspaceSession } from '../../shared/constants'
import { makePaneKey } from '../../shared/stable-pane-id'

const listWorktreesMock = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  BrowserWindow: { fromId: vi.fn(() => null) },
  webContents: { fromId: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn(), emit: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp') }
}))
vi.mock('../git/worktree', () => ({
  listWorktrees: listWorktreesMock,
  listWorktreesStrict: listWorktreesMock,
  addWorktree: vi.fn(),
  removeWorktree: vi.fn(),
  assertWorktreeCleanForRemoval: vi.fn()
}))

import { OrcaRuntimeService } from './orca-runtime'

const TEST_REPO_ID = 'repo-1'
const TEST_REPO_PATH = '/tmp/repo'
const TEST_WORKTREE_PATH = '/tmp/worktree-a'
const TEST_WORKTREE_ID = `${TEST_REPO_ID}::${TEST_WORKTREE_PATH}`

const MOCK_GIT_WORKTREES = [
  {
    path: TEST_WORKTREE_PATH,
    head: 'abc123',
    branch: 'feature/foo',
    isBare: false,
    isMainWorktree: false
  }
]

function makeStore(session: WorkspaceSessionState) {
  const base = {
    getRepo: (id: string) => base.getRepos().find((r) => r.id === id),
    getRepos: () => [
      {
        id: TEST_REPO_ID,
        path: TEST_REPO_PATH,
        displayName: 'repo',
        badgeColor: 'blue',
        addedAt: 1
      }
    ],
    getAllWorktreeMeta: () => ({
      [TEST_WORKTREE_ID]: {
        displayName: 'foo',
        comment: '',
        linkedIssue: 123,
        linkedPR: null,
        linkedLinearIssue: null,
        linkedGitLabMR: null,
        linkedGitLabIssue: null,
        isArchived: false,
        isUnread: false,
        isPinned: false,
        sortOrder: 0,
        lastActivityAt: 0
      }
    }),
    getWorktreeMeta: (id: string) => base.getAllWorktreeMeta()[id],
    setWorktreeMeta: (id: string, meta: Record<string, unknown>) => ({
      ...base.getAllWorktreeMeta()[id],
      ...meta
    }),
    getGitHubCache: () => undefined,
    getSettings: () => ({
      workspaceDir: '/tmp/workspaces',
      nestWorkspaces: false,
      refreshLocalBaseRefOnWorktreeCreate: false,
      branchPrefix: 'none',
      branchPrefixCustom: ''
    }),
    getProjects: () => [],
    getWorkspaceSession: () => session
  }
  return base
}

beforeEach(() => {
  listWorktreesMock.mockResolvedValue(MOCK_GIT_WORKTREES)
})

describe('issue #6072 stale worktree.ps state', () => {
  it('BUG: liveTerminalCount stays 1 from a persisted tab after the PTY is gone', async () => {
    // A single saved terminal tab whose PTY is no longer live (ptyId: null),
    // with no live renderer leaf and no live process for the worktree.
    const session: WorkspaceSessionState = {
      ...getDefaultWorkspaceSession(),
      tabsByWorktree: {
        [TEST_WORKTREE_ID]: [
          {
            id: 'closed-tab',
            ptyId: null,
            worktreeId: TEST_WORKTREE_ID,
            title: 'claude — Done',
            customTitle: null,
            color: null,
            sortOrder: 0,
            createdAt: 1
          }
        ]
      }
    }
    const runtime = new OrcaRuntimeService(makeStore(session) as never)
    // No live process backs the saved tab.
    runtime.setPtyController({
      write: vi.fn(() => true),
      kill: vi.fn(() => true),
      getForegroundProcess: vi.fn(async () => null),
      listProcesses: vi.fn(async () => [])
    } as never)

    const { worktrees } = await runtime.getWorktreePs()
    const summary = worktrees.find((w) => w.worktreeId === TEST_WORKTREE_ID)
    expect(summary).toBeDefined()

    // BUG (#6072): saved tab count is treated as a live terminal count via
    // Math.max(liveTerminalCount, tabs.length), so this is 1 even though no
    // live PTY/leaf/process exists.
    // CORRECT would be: liveTerminalCount === 0 once the final PTY is gone.
    expect(summary!.liveTerminalCount).toBe(1)
  })

  it('BUG: a finished (done) agent whose tab is closed still appears in summary.agents', async () => {
    // Tab is fully closed: tabsByWorktree is empty, no live leaves/PTYs.
    const session: WorkspaceSessionState = {
      ...getDefaultWorkspaceSession(),
      tabsByWorktree: {}
    }
    const closedPaneKey = makePaneKey('closed-tab', '11111111-1111-4111-8111-111111111111')
    const runtime = new OrcaRuntimeService(makeStore(session) as never, undefined, {
      // Hydrated agent-hook snapshot (last-status.json can hydrate for days).
      // The tab it belonged to is closed, but the row still carries worktreeId.
      getAgentStatusSnapshot: () => [
        {
          paneKey: closedPaneKey,
          state: 'done',
          prompt: 'refactor the parser',
          agentType: 'claude',
          connectionId: null,
          receivedAt: Date.now(),
          stateStartedAt: Date.now() - 60_000,
          tabId: 'closed-tab',
          worktreeId: TEST_WORKTREE_ID
        }
      ]
    })
    runtime.setPtyController({
      write: vi.fn(() => true),
      kill: vi.fn(() => true),
      getForegroundProcess: vi.fn(async () => null),
      listProcesses: vi.fn(async () => [])
    } as never)

    const { worktrees } = await runtime.getWorktreePs()
    const summary = worktrees.find((w) => w.worktreeId === TEST_WORKTREE_ID)
    expect(summary).toBeDefined()

    // BUG (#6072): attachAgentRowsToSummaries resolves the row by src.worktreeId
    // without checking that the pane/tab still exists, so the finished agent is
    // still shown as a current row on the worktree.
    // CORRECT would be: summary.agents === [] because the tab was closed.
    expect(summary!.agents).toHaveLength(1)
    expect(summary!.agents[0]).toMatchObject({ paneKey: closedPaneKey, state: 'done' })
  })
})

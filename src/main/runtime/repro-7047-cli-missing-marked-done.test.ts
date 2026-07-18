/**
 * Repro for issue #7047: "Agent is marked as 'Done' when the CLI is not installed".
 *
 * Scenario (Orca server / headless serve, viewed from a web/mobile client):
 *   - A user starts a Codex agent on a host where the `codex` CLI is missing.
 *   - The launched PTY runs, the shell reports `command not found` (exit 127),
 *     and the agent never actually starts.
 *   - The runtime tracks the PTY (launchAgent = 'codex', lastExitCode = 127) and,
 *     because the agent left an idle/agent-classified title behind, still has a
 *     non-null `lastAgentStatus` of 'idle' — it never reached 'working'.
 *
 * This test imports the REAL product runtime (OrcaRuntimeService) and calls the
 * REAL private derivation `buildPtyMobileAgentStatus` — the function that builds
 * the agentStatus every web/mobile client sees for a headless server tab.
 *
 * BUG being pinned: the derivation only looks at `lastAgentStatus`. Anything that
 * is not 'working' or 'permission' collapses to state 'done' (orca-runtime.ts
 * around line 22530). It never consults `lastExitCode` (127 here), so an agent
 * whose CLI was never installed is reported to the client as **done** rather than
 * failed. The assertions below PASS on the current tree while encoding the WRONG
 * result.
 */
import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'
import { makePaneKey } from '../../shared/stable-pane-id'
import type { RuntimeMobileSessionTerminalTab } from '../../shared/runtime-types'

// electron cannot be imported in a plain node/vitest environment; the runtime
// only needs these surfaces to construct.
vi.mock('electron', () => ({
  BrowserWindow: { fromId: vi.fn(() => null) },
  webContents: { fromId: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn(), emit: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp') }
}))
vi.mock('../ipc/filesystem-watcher', () => ({
  closeLocalWatcherForWorktreePath: vi.fn(),
  closeRemoteWatcherForWorktreePath: vi.fn(),
  restoreLocalWatcherAfterFailedRemoval: vi.fn(),
  restoreRemoteWatcherAfterFailedRemoval: vi.fn(),
  forgetLocalWatcherRemovalSnapshot: vi.fn(),
  forgetRemoteWatcherRemovalSnapshot: vi.fn()
}))

const TEST_WORKTREE_ID = 'repo-1::/tmp/worktree-a'
const TAB_ID = 'codex-tab'
const LEAF_ID = '11111111-1111-4111-8111-111111111111'

const store = {
  getRepo: () => undefined,
  getRepos: () => [],
  addRepo: () => {},
  updateRepo: () => ({}) as never,
  getAllWorktreeMeta: () => ({}),
  getWorktreeMeta: () => undefined,
  setWorktreeMeta: () => ({}) as never,
  removeWorktreeMeta: () => {},
  getSparsePresets: () => [],
  saveSparsePreset: (preset: unknown) => preset as never,
  getGitHubCache: () => undefined as never,
  getSettings: () => ({
    workspaceDir: '/tmp/workspaces',
    nestWorkspaces: false,
    refreshLocalBaseRefOnWorktreeCreate: false,
    branchPrefix: 'none',
    branchPrefixCustom: ''
  }),
  getProjects: () => []
}

/**
 * A PTY record shaped exactly like the runtime tracks a launched-but-failed
 * Codex agent: launchAgent codex, a non-zero exit code (127 = command not
 * found), and a stale idle agent title left behind by the aborted launch.
 */
function missingCliCodexPtyRecord(): Parameters<
  OrcaRuntimeService['buildPtyMobileAgentStatus']
>[0] {
  const now = Date.now()
  return {
    ptyId: 'pty-codex-missing',
    worktreeId: TEST_WORKTREE_ID,
    connectionId: null,
    isWsl: null,
    tabId: TAB_ID,
    paneKey: makePaneKey(TAB_ID, LEAF_ID),
    launchConfig: null,
    launchToken: null,
    launchAgent: 'codex',
    foregroundAgent: null,
    connected: true,
    disconnectedAt: null,
    // The shell reported `zsh: command not found: codex`.
    lastExitCode: 127,
    // Never reached 'working' — the CLI never ran. The agent title lingers as idle.
    lastAgentStatus: 'idle',
    lastOscTitle: 'Codex',
    lastOscTitleAt: now,
    managementTitle: null,
    managementTitleAt: null,
    title: 'Codex',
    titleUpdatedAt: now,
    lastOutputAt: now,
    tailBuffer: [],
    tailTranscriptBuffer: [],
    tailTranscriptChars: 0,
    tailPartialLine: '',
    tailPendingAnsi: '',
    tailRedrawCursor: null,
    tailTruncated: false,
    tailLinesTotal: 0,
    preview: '',
    waitBlockedAt: null
  } as unknown as Parameters<OrcaRuntimeService['buildPtyMobileAgentStatus']>[0]
}

function codexMobileTab(): RuntimeMobileSessionTerminalTab {
  return {
    type: 'terminal',
    id: `${TAB_ID}:${LEAF_ID}`,
    title: 'Codex',
    parentTabId: TAB_ID,
    leafId: LEAF_ID,
    launchAgent: 'codex',
    isActive: true
  }
}

describe('issue #7047 — CLI-missing agent reported as done to mobile/web clients', () => {
  it('derives state "done" for a codex agent that exited 127 (command not found)', () => {
    const runtime = new OrcaRuntimeService(store as never)

    // Call the REAL derivation the headless server uses to tell every paired
    // web/mobile client what state a terminal tab's agent is in.
    const result = (
      runtime as unknown as {
        buildPtyMobileAgentStatus: (
          pty: ReturnType<typeof missingCliCodexPtyRecord>,
          tab: RuntimeMobileSessionTerminalTab,
          terminalHandle: string | null
        ) => { agentStatus?: { state?: string; agentType?: string } } | Record<string, never>
      }
    ).buildPtyMobileAgentStatus(missingCliCodexPtyRecord(), codexMobileTab(), 'handle-1')

    const agentStatus = 'agentStatus' in result ? result.agentStatus : undefined

    // The runtime DID surface an agent row (agent identity survives)...
    expect(agentStatus).toBeDefined()
    expect(agentStatus?.agentType).toBe('codex')

    // BUG (#7047): the agent never ran (exit code 127), yet the client is told
    // the agent is "done". Correct behavior would be a failure state (e.g.
    // 'failed'), or at minimum NOT 'done'. This assertion PASSES today, pinning
    // the buggy derivation.
    expect(agentStatus?.state).toBe('done')

    // Corollary: the exit code is available on the record but the derivation
    // ignores it. If it were consulted, state would not be 'done'.
    expect(agentStatus?.state).not.toBe('failed')
  })

  it('ignores lastExitCode entirely — a 127 (failed) and a 0 (clean) exit both derive "done"', () => {
    const runtime = new OrcaRuntimeService(store as never)
    const call = (pty: ReturnType<typeof missingCliCodexPtyRecord>): string | undefined => {
      const result = (
        runtime as unknown as {
          buildPtyMobileAgentStatus: (
            pty: ReturnType<typeof missingCliCodexPtyRecord>,
            tab: RuntimeMobileSessionTerminalTab,
            terminalHandle: string | null
          ) => { agentStatus?: { state?: string } } | Record<string, never>
        }
      ).buildPtyMobileAgentStatus(pty, codexMobileTab(), 'handle-1')
      return 'agentStatus' in result ? result.agentStatus?.state : undefined
    }

    const failed = missingCliCodexPtyRecord() // lastExitCode 127
    const clean = { ...missingCliCodexPtyRecord(), lastExitCode: 0 }

    // BUG (#7047): the failed (never-installed) run is indistinguishable from a
    // clean one — both report 'done'. The 127 exit code carries the "command not
    // found" signal but is never read by the status derivation.
    expect(call(failed)).toBe('done')
    expect(call(clean as typeof failed)).toBe('done')
    expect(call(failed)).toBe(call(clean as typeof failed))
  })
})

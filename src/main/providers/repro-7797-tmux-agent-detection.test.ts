import { beforeEach, describe, expect, it, vi } from 'vitest'

// Repro for issue #7797: agents running inside a user's tmux session are not
// detected as running. Live foreground detection walks the process tree DOWNWARD
// from the pane's shell pid (`collectDescendants` in agent-foreground-process.ts).
// tmux double-forks its server and reparents it to pid 1, so every pane process —
// including `claude` — is a child of the tmux SERVER, not of the pane shell. The
// descendant walk from the shell pid therefore only reaches the tmux CLIENT (not
// a recognized agent) and falls back to reporting `tmux`.

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn()
}))

vi.mock('child_process', () => ({
  execFile: execFileMock
}))

import { resetProcessTableSnapshotForTests } from '../../shared/process-table-snapshot'
import { resolveAgentForegroundProcess } from './agent-foreground-process'

// Why: the module wraps execFile with promisify, so the mock must honor the
// Node callback contract — invoke the last arg with (err, { stdout, stderr }).
function mockPs(stdout: string): void {
  execFileMock.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: unknown) => {
    const callback = cb as (err: unknown, result: { stdout: string; stderr: string }) => void
    callback(null, { stdout, stderr: '' })
  })
}

// Process table for a pane running `tmux` with `claude` inside a tmux window.
//   pid 100  ppid 99  zsh              <- Orca pane shell (root of foreground walk)
//   pid 101  ppid 100 tmux client      <- what the shell actually launched
//   pid 200  ppid 1   tmux server      <- double-forked, reparented to init (pid 1)
//   pid 201  ppid 200 claude           <- the real agent, child of the SERVER
const TMUX_PROCESS_TABLE = [
  '100 99  Ss   -zsh',
  '101 100 S+   tmux',
  '200 1   Ss   tmux',
  '201 200 S+   node /Users/dev/.nvm/versions/node/bin/claude'
].join('\n')

describe('resolveAgentForegroundProcess with an agent inside tmux (issue #7797)', () => {
  beforeEach(() => {
    execFileMock.mockReset()
    resetProcessTableSnapshotForTests()
    Object.defineProperty(process, 'platform', { value: 'darwin' })
  })

  it('BUG: fails to detect claude running inside tmux, reports tmux instead', async () => {
    mockPs(TMUX_PROCESS_TABLE)

    // The pane shell is pid 100 and its detected foreground name is "tmux".
    const result = await resolveAgentForegroundProcess(100, 'tmux')

    // BUGGY BEHAVIOR (pinned): the descendant walk from the shell pid only reaches
    // the tmux client (pid 101), never the claude process (pid 201, child of the
    // reparented tmux server pid 200). Detection falls back to the client name.
    expect(result).toBe('tmux')

    // CORRECT BEHAVIOR would be to detect the agent and return 'claude'. This
    // assertion documents the intended fix and MUST stay commented out while the
    // bug is present (it currently fails):
    //   expect(result).toBe('claude')
  })

  it('CONTROL: the same claude process IS recognized when walked from the tmux server pid', async () => {
    mockPs(TMUX_PROCESS_TABLE)

    // Proves the process is recognizable — it is merely unreachable from the
    // shell pid. Walking descendants of the tmux server (pid 200) finds claude.
    // This is exactly what the proposed fix does (hop to the pane pid, re-walk).
    await expect(resolveAgentForegroundProcess(200, 'tmux')).resolves.toBe('claude')
  })
})

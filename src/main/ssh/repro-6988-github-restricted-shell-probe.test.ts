/**
 * Repro for issue #6988 — System SSH probe fails on GitHub with
 * "Invalid command: echo ORCA-SYSTEM-SSH-OK".
 *
 * The system-SSH connectivity probe runs `echo ORCA-SYSTEM-SSH-OK` on the
 * remote and only reports success when exit code === 0 AND stdout contains the
 * marker (src/main/ssh/ssh-connection.ts:842 and :881). Hosts that run a
 * restricted git-shell — most notably `git@github.com` — reject any non-git
 * command with `Invalid command: <cmd>` and exit non-zero, so the probe reports
 * failure even though git-over-SSH (ls-remote/clone/push) works fine on that
 * host.
 *
 * These tests IMPORT the real SshConnection and drive the real probe method.
 * The assertions marked "BUG:" PASS on the current tree while pinning the wrong
 * behavior. Correct behavior would treat a restricted-shell host that
 * successfully authenticates as reachable (e.g. probe via `ssh -T` or a git
 * command), so the probe would NOT throw here.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Socket } from 'node:net'
import { EventEmitter } from 'node:events'

let eventHandlers: Map<string, Set<(...args: unknown[]) => void>>

vi.mock('ssh2', () => {
  class MockBaseAgent {}
  class MockSshClient {
    setNoDelay = vi.fn()
    _sock: Socket | undefined = new Socket()
    lastExecCommand?: string
    lastConnectConfig?: unknown
    on(event: string, handler: (...args: unknown[]) => void) {
      const handlers = eventHandlers?.get(event) ?? new Set<(...args: unknown[]) => void>()
      handlers.add(handler)
      eventHandlers?.set(event, handlers)
    }
    off(event: string, handler: (...args: unknown[]) => void) {
      eventHandlers?.get(event)?.delete(handler)
    }
    connect() {}
    end() {}
    destroy() {}
    exec(cmd: string, cb: (err: Error | undefined, channel: unknown) => void) {
      this.lastExecCommand = cmd
      cb(undefined, { close: vi.fn() })
    }
    sftp(cb: (err: Error | undefined, channel: unknown) => void) {
      cb(undefined, { end: vi.fn() })
    }
  }
  return {
    BaseAgent: MockBaseAgent,
    Client: MockSshClient,
    createAgent: vi.fn(),
    utils: { parseKey: vi.fn() }
  }
})

const { getOrcaControlSocketPathMock, spawnSystemSshCommandMock, spawnSystemSshMock } = vi.hoisted(
  () => ({
    getOrcaControlSocketPathMock: vi.fn(),
    spawnSystemSshMock: vi.fn(),
    spawnSystemSshCommandMock: vi.fn()
  })
)

vi.mock('./ssh-system-fallback', () => ({
  getOrcaControlSocketPath: getOrcaControlSocketPathMock,
  spawnSystemSsh: spawnSystemSshMock,
  spawnSystemSshCommand: spawnSystemSshCommandMock,
  downloadFileViaSystemSsh: vi.fn(),
  uploadDirectoryViaSystemSsh: vi.fn(),
  uploadFileViaSystemSsh: vi.fn(),
  writeBufferViaSystemSsh: vi.fn(),
  writeFileViaSystemSsh: vi.fn()
}))

vi.mock('./ssh-control-socket', () => ({
  removeControlSocketPath: vi.fn()
}))

vi.mock('./ssh-config-parser', () => ({
  resolveWithSshG: vi.fn().mockResolvedValue(null)
}))

import { SshConnection, type SshConnectionCallbacks } from './ssh-connection'
import type { SshTarget } from '../../shared/ssh-types'

// Exactly what GitHub's restricted git-shell writes to stderr for a non-git
// command, followed by a non-zero exit — see the issue report.
const GITHUB_INVALID_COMMAND_STDERR =
  'Invalid command: echo ORCA-SYSTEM-SSH-OK\n' +
  '  You appear to be using ssh to clone a git:// URL.\n' +
  '  Make sure your core.gitProxy config option and the\n' +
  '  GIT_PROXY_COMMAND environment variable are NOT set.\n'

function createGithubRestrictedShellChannel(): EventEmitter & {
  stdin: { end: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn> }
  stderr: EventEmitter
  close: ReturnType<typeof vi.fn>
} {
  const channel = new EventEmitter() as EventEmitter & {
    stdin: { end: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn> }
    stderr: EventEmitter
    close: ReturnType<typeof vi.fn>
  }
  channel.stdin = { end: vi.fn(), write: vi.fn() }
  channel.stderr = new EventEmitter()
  channel.close = vi.fn()
  queueMicrotask(() => {
    // git-shell rejects the command: writes to stderr, no stdout, exit 1.
    channel.stderr.emit('data', Buffer.from(GITHUB_INVALID_COMMAND_STDERR))
    channel.emit('close', 1)
  })
  return channel
}

function createTarget(overrides?: Partial<SshTarget>): SshTarget {
  return {
    id: 'gh-target',
    label: 'GitHub',
    host: 'github.com',
    port: 22,
    username: 'git',
    ...overrides
  }
}

function createCallbacks(): SshConnectionCallbacks {
  return { onStateChange: vi.fn() }
}

describe('issue #6988: system SSH probe on GitHub restricted git-shell', () => {
  beforeEach(() => {
    eventHandlers = new Map()
    getOrcaControlSocketPathMock.mockReset()
    getOrcaControlSocketPathMock.mockReturnValue(null)
    spawnSystemSshCommandMock.mockReset()
    spawnSystemSshCommandMock.mockImplementation(() => createGithubRestrictedShellChannel())
  })

  it('sends the shell-only `echo` command GitHub cannot run, and reports failure', async () => {
    const conn = new SshConnection(createTarget(), createCallbacks())
    const privateConn = conn as unknown as {
      doSystemSshProbe: (generation: number) => Promise<void>
      connectGeneration: number
    }

    const probeOutcome = await privateConn
      .doSystemSshProbe(privateConn.connectGeneration)
      .then(() => 'connected')
      .catch((err: Error) => err.message)

    // BUG: the probe throws "System SSH probe failed (exit 1)" even though this
    // host authenticates and serves git over SSH. Correct behavior: the probe
    // should NOT fail on a host that authenticated successfully.
    expect(probeOutcome).toContain('System SSH probe failed (exit 1)')
    // The reason is verbatim GitHub's rejection of the echo command.
    expect(probeOutcome).toContain('Invalid command: echo ORCA-SYSTEM-SSH-OK')

    // BUG root cause: the probe command is a bare shell `echo`, which GitHub's
    // git-shell (and any restricted shell) rejects. A `ssh -T` / git-command
    // probe would be accepted.
    expect(spawnSystemSshCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'github.com' }),
      'echo ORCA-SYSTEM-SSH-OK',
      { wrapCommand: false }
    )

    // The connection is left un-connected because the cosmetic probe failed.
    expect(conn.getState().status).not.toBe('connected')
  })
})

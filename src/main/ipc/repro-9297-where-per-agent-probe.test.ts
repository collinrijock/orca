/* Repro for issue #9297: Startup hangs/crashes on Windows because agent
 * detection shells out to `where.exe` (one subprocess PER agent candidate)
 * instead of resolving executables against process.env.PATH with Node's fs.
 *
 * This test imports the REAL product module (`detectInstalledAgents` in
 * ./preflight) and mocks ONLY the subprocess boundary (child_process) plus a
 * few unrelated network/fs helpers. It PINS the buggy behavior:
 *   - On win32, detection spawns `where` once for every probe command.
 *   - The number of spawns scales with the ~30 known agent candidates.
 * Under corporate privilege-management software that gates each `where.exe`
 * spawn behind an interactive approval, N gated spawns stall main-process
 * startup (issue reports up to ~5 min). Same root cause as macOS #5657.
 *
 * The assertions marked "BUG" encode the WRONG behavior. The correct fix
 * (per the issue) is fs-based PATH resolution: ZERO `where`/`which` spawns.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  handleMock,
  execFileMock,
  execFileAsyncMock,
  hydrateShellPathMock,
  mergePathSegmentsMock,
  getActiveMultiplexerMock,
  getBitbucketAuthStatusMock,
  getAzureDevOpsAuthStatusMock,
  getGiteaAuthStatusMock,
  detectCommandsInInstallDirsMock,
  mergePersistedWindowsPathMock
} = vi.hoisted(() => ({
  handleMock: vi.fn(),
  execFileMock: vi.fn(),
  execFileAsyncMock: vi.fn(),
  hydrateShellPathMock: vi.fn(),
  mergePathSegmentsMock: vi.fn(),
  getActiveMultiplexerMock: vi.fn(),
  getBitbucketAuthStatusMock: vi.fn(),
  getAzureDevOpsAuthStatusMock: vi.fn(),
  getGiteaAuthStatusMock: vi.fn(),
  detectCommandsInInstallDirsMock: vi.fn(),
  mergePersistedWindowsPathMock: vi.fn()
}))

vi.mock('electron', () => ({ ipcMain: { handle: handleMock } }))

vi.mock('child_process', () => {
  const execFileWithPromisify = Object.assign(execFileMock, {
    [Symbol.for('nodejs.util.promisify.custom')]: execFileAsyncMock
  })
  return { execFile: execFileWithPromisify, spawn: vi.fn() }
})

vi.mock('../startup/hydrate-shell-path', () => ({
  hydrateShellPath: hydrateShellPathMock,
  mergePathSegments: mergePathSegmentsMock
}))

vi.mock('./ssh', () => ({ getActiveMultiplexer: getActiveMultiplexerMock }))
vi.mock('../bitbucket/client', () => ({ getBitbucketAuthStatus: getBitbucketAuthStatusMock }))
vi.mock('../azure-devops/client', () => ({
  getAzureDevOpsAuthStatus: getAzureDevOpsAuthStatusMock
}))
vi.mock('../gitea/client', () => ({ getGiteaAuthStatus: getGiteaAuthStatusMock }))

// Isolate the subprocess-spawn assertion from the fs-based install-dir fallback.
vi.mock('./local-agent-install-dir-detection', () => ({
  detectCommandsInInstallDirs: detectCommandsInInstallDirsMock
}))

// Win32 preflight env merge reads persisted registry PATH; stub it out.
vi.mock('../pty/windows-environment-path', () => ({
  mergePersistedWindowsPath: mergePersistedWindowsPathMock
}))

import { _resetPreflightCache, detectInstalledAgents } from './preflight'
import {
  getTuiAgentDetectionProbeCommands,
  KNOWN_TUI_AGENT_DETECTION_COMMANDS
} from './tui-agent-detection-commands'

describe('repro #9297: where.exe subprocess spawned per agent candidate', () => {
  const originalPlatform = process.platform

  beforeEach(() => {
    execFileAsyncMock.mockReset()
    detectCommandsInInstallDirsMock.mockReset()
    detectCommandsInInstallDirsMock.mockReturnValue(new Set<string>())
    _resetPreflightCache()
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { configurable: true, value: originalPlatform })
  })

  it('spawns a `where` subprocess for every known agent probe command (the bug)', async () => {
    const probedCommands: string[] = []
    // Simulate the environment in the report: `where.exe` is gated, so every
    // probe fails/returns nothing. We record each spawn to prove one-per-agent.
    execFileAsyncMock.mockImplementation(async (command: string, args: string[]) => {
      // BUG: detection resolves PATH by spawning the OS `where` binary rather
      // than reading process.env.PATH via fs. On Windows this is `where.exe`.
      expect(command).toBe('where')
      probedCommands.push(String(args[0]))
      throw new Error('not found') // gated / absent -> isCommandOnPath === false
    })

    const agents = await detectInstalledAgents()
    expect(agents).toEqual([])

    const expectedProbes = getTuiAgentDetectionProbeCommands(
      KNOWN_TUI_AGENT_DETECTION_COMMANDS,
      'win32'
    )

    // BUG (core of #9297): one subprocess spawn per candidate. The correct
    // behavior would spawn ZERO `where`/`which` processes (fs-based lookup),
    // so this count would be 0 after the fix.
    expect(execFileAsyncMock).toHaveBeenCalledTimes(expectedProbes.length)
    expect(new Set(probedCommands)).toEqual(new Set(expectedProbes))

    // Guardrail: the candidate list is large (~30 CLIs), so a gated/slow
    // `where.exe` is multiplied across dozens of spawns at startup.
    expect(expectedProbes.length).toBeGreaterThanOrEqual(20)
  })
})

import { fork, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import type { TestInfo } from '@playwright/test'
import {
  getDaemonPidPath,
  getDaemonSocketPath,
  getDaemonTokenPath
} from '../../../src/main/daemon/daemon-spawner'
import {
  recordProcessIdentity,
  recordProcessTree,
  terminateRecordedTree,
  type RecordedProcessIdentity
} from './daemon-generation-processes'

export const PREVIOUS_PROTOCOL_VERSION = 21
export const CURRENT_FIXTURE_PROTOCOL_VERSION = 22
const MAX_STARTUP_LOG_CHARS = 8_192
const FIXTURE_TEMP_ROOT = process.platform === 'darwin' ? path.join(path.sep, 'tmp') : tmpdir()

export type DaemonGenerationArtifact = {
  label: string
  protocolVersion: number
  child: ChildProcess
  daemonIdentity: RecordedProcessIdentity
  entryPath: string
  executablePath: string
  socketPath: string
  tokenPath: string
  pidPath: string
  launchNonce: string | null
  startupLog: () => string
}

export type DaemonGenerationRuntime = {
  rootDir: string
  userDataDir: string
  daemonDir: string
  markerScriptPath: string
  currentFixtureEntryPath: string
  localElectronExecutablePath: string
  retainDiagnostics(daemons: DaemonGenerationArtifact[]): void
  remove(): void
}

function normalizeForContainment(candidate: string): string {
  const normalized = path.resolve(candidate)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function isEqualToOrInside(candidate: string, parent: string): boolean {
  const normalizedCandidate = normalizeForContainment(candidate)
  const normalizedParent = normalizeForContainment(parent)
  return (
    normalizedCandidate === normalizedParent ||
    normalizedCandidate.startsWith(`${normalizedParent}${path.sep}`)
  )
}

function knownOrcaUserDataDirs(): string[] {
  if (process.platform === 'darwin') {
    const appSupport = path.join(homedir(), 'Library', 'Application Support')
    return [path.join(appSupport, 'orca'), path.join(appSupport, 'orca-dev')]
  }
  if (process.platform === 'win32') {
    const roaming = process.env.APPDATA ?? path.join(homedir(), 'AppData', 'Roaming')
    return [path.join(roaming, 'orca'), path.join(roaming, 'orca-dev')]
  }
  const config = process.env.XDG_CONFIG_HOME ?? path.join(homedir(), '.config')
  return [path.join(config, 'orca'), path.join(config, 'orca-dev')]
}

function assertDisposableRuntime(rootDir: string): void {
  if (!path.basename(rootDir).startsWith('orca-dg-')) {
    throw new Error('Refusing daemon fixture runtime without the expected mkdtemp prefix')
  }
  if (!isEqualToOrInside(rootDir, FIXTURE_TEMP_ROOT)) {
    throw new Error('Daemon fixture runtime escaped the OS temporary directory')
  }
  for (const realUserDataDir of knownOrcaUserDataDirs()) {
    if (isEqualToOrInside(rootDir, realUserDataDir)) {
      throw new Error('Refusing daemon fixture runtime inside a real Orca user-data directory')
    }
  }
}

function resolveLocalElectronExecutable(repoRoot: string): string {
  const electronDist = path.join(repoRoot, 'node_modules', 'electron', 'dist')
  const relativeExecutable = readFileSync(
    path.join(repoRoot, 'node_modules', 'electron', 'path.txt'),
    'utf8'
  ).trim()
  const executable = path.join(electronDist, relativeExecutable)
  if (!existsSync(executable)) {
    throw new Error(`Local Electron executable is missing: ${executable}`)
  }
  return executable
}

export async function createDaemonGenerationRuntime(
  testInfo: TestInfo
): Promise<DaemonGenerationRuntime> {
  mkdirSync(testInfo.outputDir, { recursive: true })
  // Why: Unix-domain sockets have a ~104-byte path ceiling on macOS. A short
  // OS-temp root keeps both versioned endpoints beneath that hard limit.
  const rootDir = mkdtempSync(path.join(FIXTURE_TEMP_ROOT, 'orca-dg-'))
  assertDisposableRuntime(rootDir)
  const userDataDir = path.join(rootDir, 'user-data')
  const daemonDir = path.join(userDataDir, 'daemon')
  mkdirSync(path.join(userDataDir, 'profiles', 'profile-a'), { recursive: true })
  mkdirSync(path.join(userDataDir, 'profiles', 'profile-b'), { recursive: true })
  mkdirSync(daemonDir, { recursive: true })
  writeFileSync(
    path.join(userDataDir, 'profiles', 'profile-a', 'orca-data.json'),
    JSON.stringify({ version: 1, terminalLayoutsByTabId: {} })
  )
  writeFileSync(
    path.join(userDataDir, 'profiles', 'profile-b', 'orca-data.json'),
    JSON.stringify({ version: 1, terminalLayoutsByTabId: {} })
  )

  const repoRoot = process.cwd()
  const currentFixtureEntryPath = path.join(rootDir, 'daemon-generation-entry.cjs')
  await build({
    entryPoints: [path.join(repoRoot, 'tests', 'e2e', 'fixtures', 'daemon-generation-entry.ts')],
    outfile: currentFixtureEntryPath,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['node-pty'],
    logLevel: 'silent'
  })

  return {
    rootDir,
    userDataDir,
    daemonDir,
    markerScriptPath: path.join(
      repoRoot,
      'tests',
      'e2e',
      'fixtures',
      'daemon-generation-marker.cjs'
    ),
    currentFixtureEntryPath,
    localElectronExecutablePath: resolveLocalElectronExecutable(repoRoot),
    retainDiagnostics: (daemons) => {
      const diagnostics = daemons.map((daemon) => ({
        label: daemon.label,
        protocolVersion: daemon.protocolVersion,
        pid: daemon.daemonIdentity.pid,
        pidArtifactExists: existsSync(daemon.pidPath),
        tokenArtifactExists: existsSync(daemon.tokenPath),
        endpointArtifactExists: process.platform === 'win32' ? null : existsSync(daemon.socketPath),
        startupLogTail: daemon.startupLog().slice(-MAX_STARTUP_LOG_CHARS)
      }))
      writeFileSync(
        testInfo.outputPath('daemon-generation-diagnostics.json'),
        `${JSON.stringify(diagnostics, null, 2)}\n`
      )
    },
    remove: () => {
      assertDisposableRuntime(rootDir)
      rmSync(rootDir, { recursive: true, force: true })
    }
  }
}

export async function launchDaemonGeneration(options: {
  runtime: DaemonGenerationRuntime
  label: DaemonGenerationArtifact['label']
  protocolVersion: number
  entryPath: string
  executablePath: string
  validateReportedStart?: boolean
  idleShutdownMs?: number
}): Promise<DaemonGenerationArtifact> {
  const {
    runtime,
    label,
    protocolVersion,
    entryPath,
    executablePath,
    validateReportedStart = true,
    idleShutdownMs
  } = options
  const socketPath = getDaemonSocketPath(runtime.daemonDir, protocolVersion)
  const tokenPath = getDaemonTokenPath(runtime.daemonDir, protocolVersion)
  const pidPath = getDaemonPidPath(runtime.daemonDir, protocolVersion)
  const launchNonce = idleShutdownMs === undefined ? null : randomUUID()
  let stderr = ''
  const fixtureLifecycleArgs =
    idleShutdownMs === undefined || launchNonce === null
      ? []
      : [
          '--idle-shutdown-ms',
          String(idleShutdownMs),
          '--pid-record',
          pidPath,
          '--launch-nonce',
          launchNonce
        ]
  const child = fork(
    entryPath,
    [
      '--protocol',
      String(protocolVersion),
      '--socket',
      socketPath,
      '--token',
      tokenPath,
      ...fixtureLifecycleArgs
    ],
    {
      cwd: runtime.userDataDir,
      execPath: executablePath,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        NODE_PATH: path.join(process.cwd(), 'node_modules'),
        ORCA_USER_DATA_PATH: runtime.userDataDir
      },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc']
    }
  )
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr = `${stderr}${chunk.toString('utf8')}`.slice(-MAX_STARTUP_LOG_CHARS)
  })

  try {
    const ready = await new Promise<{ startedAtMs?: unknown }>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`${label} daemon startup timed out: ${stderr}`))
      }, 15_000)
      const settle = (callback: () => void): void => {
        clearTimeout(timer)
        child.off('error', onError)
        child.off('exit', onExit)
        callback()
      }
      const onError = (error: Error): void => settle(() => reject(error))
      const onExit = (code: number | null): void =>
        settle(() => reject(new Error(`${label} daemon exited with code ${code}: ${stderr}`)))
      child.once('error', onError)
      child.once('exit', onExit)
      child.once('message', (message) => {
        if (
          message &&
          typeof message === 'object' &&
          (message as { type?: unknown }).type === 'ready'
        ) {
          settle(() => resolve(message as { startedAtMs?: unknown }))
        }
      })
    })
    if (!child.pid) {
      throw new Error(`${label} daemon did not expose its pid`)
    }
    const daemonIdentity = await recordProcessIdentity(child.pid)
    const reportedStart = ready.startedAtMs
    if (
      validateReportedStart &&
      typeof reportedStart === 'number' &&
      Math.abs(reportedStart - daemonIdentity.startedAtMs) > 2_000
    ) {
      throw new Error(`${label} daemon self-reported a different process incarnation`)
    }
    writeFileSync(
      pidPath,
      `${JSON.stringify({
        pid: daemonIdentity.pid,
        startedAtMs: daemonIdentity.startedAtMs,
        entryPath,
        fixtureNonce: randomUUID(),
        ...(launchNonce ? { launchNonce } : {})
      })}\n`,
      { mode: 0o600 }
    )
    child.disconnect()
    return {
      label,
      protocolVersion,
      child,
      daemonIdentity,
      entryPath,
      executablePath,
      socketPath,
      tokenPath,
      pidPath,
      launchNonce,
      startupLog: () => stderr
    }
  } catch (error) {
    if (child.pid) {
      try {
        const identity = await recordProcessIdentity(child.pid)
        await terminateRecordedTree(await recordProcessTree(identity))
      } catch {
        // Startup may have exited before its identity could be recorded.
      }
    }
    throw error
  }
}

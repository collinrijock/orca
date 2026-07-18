import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { connect } from 'node:net'
import { test, expect, type TestInfo } from '@playwright/test'
import { DaemonPtyAdapter } from '../../src/main/daemon/daemon-pty-adapter'
import { PROTOCOL_VERSION } from '../../src/main/daemon/types'
import {
  CURRENT_FIXTURE_PROTOCOL_VERSION,
  PREVIOUS_PROTOCOL_VERSION,
  createDaemonGenerationRuntime,
  launchDaemonGeneration,
  type DaemonGenerationArtifact,
  type DaemonGenerationRuntime
} from './helpers/daemon-generation-fixtures'
import { prepareOfficialV21Fixture } from './helpers/daemon-generation-v21-release'
import {
  anyRecordedProcessIsAlive,
  processIdentityIsAlive,
  readRecordedProcessCommandLine,
  recordProcessIdentity,
  recordProcessTree,
  terminateRecordedTree,
  waitForCondition,
  type RecordedProcessIdentity
} from './helpers/daemon-generation-processes'

type PreviousGenerationExecutable = {
  entryPath: string
  executablePath: string
  source: 'test-owned-protocol' | 'official-v1.4.139'
}

type TwoGenerationTopology = {
  previousProtocolVersion: number
  currentProtocolVersion: number
  previousLabel: string
  currentLabel: string
}

const V21_TO_V22_TOPOLOGY: TwoGenerationTopology = {
  previousProtocolVersion: PREVIOUS_PROTOCOL_VERSION,
  currentProtocolVersion: CURRENT_FIXTURE_PROTOCOL_VERSION,
  previousLabel: 'previous-v21',
  currentLabel: 'current-v22'
}

type MarkerSession = {
  adapter: DaemonPtyAdapter
  sessionId: string
  sessionIdentity: RecordedProcessIdentity
  descendantIdentity: RecordedProcessIdentity
  output: () => string
}

const MAX_CAPTURED_OUTPUT_CHARS = 16_384

function markerCommand(runtime: DaemonGenerationRuntime, label: string, nonce: string): string {
  const escapedPath = runtime.markerScriptPath.replaceAll('"', '\\"')
  return `node "${escapedPath}" session ${label} ${nonce}`
}

function attachBoundedOutput(adapter: DaemonPtyAdapter, sessionId: string): () => string {
  let output = ''
  adapter.onData((event) => {
    if (event.id === sessionId) {
      output = `${output}${event.data}`.slice(-MAX_CAPTURED_OUTPUT_CHARS)
    }
  })
  return () => output
}

async function spawnMarkerSession(options: {
  runtime: DaemonGenerationRuntime
  daemon: DaemonGenerationArtifact
  label: string
  nonce: string
}): Promise<MarkerSession> {
  const { runtime, daemon, label, nonce } = options
  const sessionId = `daemon-generation-${label}@@${randomUUID().slice(0, 8)}`
  const adapter = new DaemonPtyAdapter({
    socketPath: daemon.socketPath,
    tokenPath: daemon.tokenPath,
    protocolVersion: daemon.protocolVersion
  })
  const output = attachBoundedOutput(adapter, sessionId)
  const result = await adapter.spawn({
    sessionId,
    isNewSession: true,
    cols: 100,
    rows: 30,
    cwd: runtime.rootDir,
    command: markerCommand(runtime, label, nonce)
  })
  if (!result.pid) {
    throw new Error(`${label} marker session did not expose its root pid`)
  }
  await waitForCondition(`${label} marker readiness`, () =>
    output().includes(`ORCA_DAEMON_MARKER_READY ${label} ${nonce}`)
  )
  const readyPattern = new RegExp(`ORCA_DAEMON_MARKER_READY ${label} ${nonce} (\\d+)`)
  const descendantPid = Number(readyPattern.exec(output())?.[1])
  if (!Number.isInteger(descendantPid)) {
    throw new Error(`${label} marker did not report its descendant pid`)
  }
  const sessionIdentity = await recordProcessIdentity(result.pid)
  const descendantIdentity = await recordProcessIdentity(descendantPid)
  const tree = await recordProcessTree(sessionIdentity)
  expect(tree.some((identity) => identity.pid === descendantIdentity.pid)).toBe(true)
  return { adapter, sessionId, sessionIdentity, descendantIdentity, output }
}

async function pingMarker(marker: MarkerSession, label: string, nonce: string): Promise<void> {
  const reply = `ORCA_DAEMON_MARKER_ACK ${label} ${nonce}`
  marker.adapter.write(marker.sessionId, `PING ${label} ${nonce}\r`)
  await waitForCondition(`${label} marker fresh reply`, () => marker.output().includes(reply))
}

async function launchUnrelatedControl(
  runtime: DaemonGenerationRuntime,
  nonce: string
): Promise<{ child: ChildProcess; identity: RecordedProcessIdentity }> {
  const child = spawn(
    process.execPath,
    [runtime.markerScriptPath, 'control', 'unrelated-control', nonce],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )
  let output = ''
  child.stdout?.on('data', (chunk: Buffer) => {
    output = `${output}${chunk.toString('utf8')}`.slice(-4_096)
  })
  await waitForCondition('unrelated control readiness', () =>
    output.includes(`ORCA_DAEMON_CONTROL_READY unrelated-control ${nonce}`)
  )
  if (!child.pid) {
    throw new Error('Unrelated control did not expose its pid')
  }
  return { child, identity: await recordProcessIdentity(child.pid) }
}

async function assertGenerationArtifacts(daemon: DaemonGenerationArtifact): Promise<void> {
  expect(existsSync(daemon.pidPath)).toBe(true)
  expect(existsSync(daemon.tokenPath)).toBe(true)
  if (process.platform !== 'win32') {
    expect(existsSync(daemon.socketPath)).toBe(true)
  }
  const record = JSON.parse(readFileSync(daemon.pidPath, 'utf8')) as {
    pid?: unknown
    startedAtMs?: unknown
    entryPath?: unknown
  }
  expect(record).toMatchObject({
    pid: daemon.daemonIdentity.pid,
    startedAtMs: daemon.daemonIdentity.startedAtMs,
    entryPath: daemon.entryPath
  })
  const commandLine = await readRecordedProcessCommandLine(daemon.daemonIdentity)
  expect(commandLine).toContain(daemon.executablePath)
  expect(commandLine).toContain(daemon.entryPath)
  expect(commandLine).toContain(daemon.socketPath)
  expect(commandLine).toContain(daemon.tokenPath)
}

async function drainFixtureLifecycleQueue(): Promise<void> {
  // Why: disconnect/exit callbacks enqueue microtasks and immediates; crossing
  // both queues is an explicit handler-drained barrier, not a timing guess.
  await Promise.resolve()
  await new Promise<void>((resolve) => setImmediate(resolve))
  await Promise.resolve()
}

async function waitForMarkerExit(marker: MarkerSession, label: string): Promise<void> {
  await waitForCondition(
    `${label} marker root and descendant exit`,
    async () =>
      !(await processIdentityIsAlive(marker.sessionIdentity)) &&
      !(await processIdentityIsAlive(marker.descendantIdentity)),
    10_000
  )
}

async function shutdownFixtureDaemons(
  daemons: DaemonGenerationArtifact[],
  recordedTrees: RecordedProcessIdentity[][]
): Promise<void> {
  for (const daemon of daemons) {
    if (await processIdentityIsAlive(daemon.daemonIdentity)) {
      try {
        process.kill(daemon.daemonIdentity.pid, 'SIGTERM')
      } catch {
        // Exact daemon incarnation exited after the preceding identity check.
      }
    }
  }
  for (const tree of recordedTrees) {
    await terminateRecordedTree(tree)
  }
}

async function waitForFixtureChildExit(
  child: ChildProcess,
  timeoutMs = 10_000
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode }
  }
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Timed out waiting for fixture daemon exit')),
      timeoutMs
    )
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal })
    })
  })
}

async function endpointRefusesConnections(endpointPath: string): Promise<boolean> {
  return await new Promise((resolve) => {
    const socket = connect(endpointPath)
    const timer = setTimeout(() => settle(false), 1_000)
    const settle = (refused: boolean): void => {
      clearTimeout(timer)
      socket.destroy()
      resolve(refused)
    }
    socket.once('connect', () => settle(false))
    socket.once('error', () => settle(true))
  })
}

async function runTwoGenerationReproduction(
  testInfo: TestInfo,
  previousExecutable: (
    runtime: DaemonGenerationRuntime
  ) => Promise<PreviousGenerationExecutable | { skipReason: string }>,
  topology: TwoGenerationTopology = V21_TO_V22_TOPOLOGY
): Promise<void> {
  test.setTimeout(600_000)
  const runtime = await createDaemonGenerationRuntime(testInfo)
  const daemonArtifacts: DaemonGenerationArtifact[] = []
  const recordedDaemonTrees: RecordedProcessIdentity[][] = []
  let unrelatedControl: { child: ChildProcess; identity: RecordedProcessIdentity } | null = null
  let previousMarker: MarkerSession | null = null
  let adoptedPreviousAdapter: DaemonPtyAdapter | null = null
  let currentMarker: MarkerSession | null = null
  let assertionsComplete = false

  try {
    const resolvedPrevious = await previousExecutable(runtime)
    if ('skipReason' in resolvedPrevious) {
      test.skip(true, resolvedPrevious.skipReason)
      return
    }
    const controlNonce = randomUUID()
    unrelatedControl = await launchUnrelatedControl(runtime, controlNonce)

    const previousDaemon = await launchDaemonGeneration({
      runtime,
      label: topology.previousLabel,
      protocolVersion: topology.previousProtocolVersion,
      entryPath: resolvedPrevious.entryPath,
      executablePath: resolvedPrevious.executablePath,
      // Why: v1.4.139 predates the current ready-message start-time contract;
      // the harness records its exact OS process-start identity independently.
      validateReportedStart: resolvedPrevious.source !== 'official-v1.4.139'
    })
    daemonArtifacts.push(previousDaemon)
    const previousNonce = randomUUID()
    previousMarker = await spawnMarkerSession({
      runtime,
      daemon: previousDaemon,
      label: topology.previousLabel,
      nonce: previousNonce
    })
    const originalPreviousSessionIdentity = previousMarker.sessionIdentity

    // Ordinary update detach leaves both the daemon and its PTY alive.
    await previousMarker.adapter.disconnectOnly()
    await drainFixtureLifecycleQueue()

    const currentDaemon = await launchDaemonGeneration({
      runtime,
      label: topology.currentLabel,
      protocolVersion: topology.currentProtocolVersion,
      entryPath: runtime.currentFixtureEntryPath,
      executablePath: runtime.localElectronExecutablePath
    })
    daemonArtifacts.push(currentDaemon)
    const currentNonce = randomUUID()
    currentMarker = await spawnMarkerSession({
      runtime,
      daemon: currentDaemon,
      label: topology.currentLabel,
      nonce: currentNonce
    })

    adoptedPreviousAdapter = new DaemonPtyAdapter({
      socketPath: previousDaemon.socketPath,
      tokenPath: previousDaemon.tokenPath,
      protocolVersion: topology.previousProtocolVersion
    })
    const adoptedOutput = attachBoundedOutput(adoptedPreviousAdapter, previousMarker.sessionId)
    const adopted = await adoptedPreviousAdapter.spawn({
      sessionId: previousMarker.sessionId,
      isNewSession: false,
      cols: 100,
      rows: 30,
      cwd: runtime.rootDir
    })
    expect(adopted.isReattach).toBe(true)
    expect(adopted.pid).toBe(originalPreviousSessionIdentity.pid)
    expect(await recordProcessIdentity(adopted.pid!)).toEqual(originalPreviousSessionIdentity)
    previousMarker = {
      ...previousMarker,
      adapter: adoptedPreviousAdapter,
      output: adoptedOutput
    }
    await pingMarker(previousMarker, topology.previousLabel, `post-upgrade-${previousNonce}`)
    await pingMarker(currentMarker, topology.currentLabel, `fresh-${currentNonce}`)

    expect(previousDaemon.daemonIdentity.pid).not.toBe(currentDaemon.daemonIdentity.pid)
    expect(previousDaemon.socketPath).not.toBe(currentDaemon.socketPath)
    expect(previousDaemon.tokenPath).not.toBe(currentDaemon.tokenPath)
    await assertGenerationArtifacts(previousDaemon)
    await assertGenerationArtifacts(currentDaemon)

    // Awaiting shutdown is the legacy provider's control-socket acknowledgement;
    // the subsequent zero-session list is the independent drained-state barrier.
    await adoptedPreviousAdapter.shutdown(previousMarker.sessionId, { immediate: true })
    await waitForMarkerExit(previousMarker, topology.previousLabel)
    expect(await adoptedPreviousAdapter.listSessions()).toEqual([])
    await drainFixtureLifecycleQueue()

    // Baseline oracle for #9138: empty legacy generations and all endpoint
    // artifacts survive after the final session and client lifecycle drains.
    adoptedPreviousAdapter.dispose()
    adoptedPreviousAdapter = null
    await drainFixtureLifecycleQueue()
    expect(await processIdentityIsAlive(previousDaemon.daemonIdentity)).toBe(true)
    await assertGenerationArtifacts(previousDaemon)
    expect(await processIdentityIsAlive(unrelatedControl.identity)).toBe(true)

    for (const daemon of daemonArtifacts) {
      recordedDaemonTrees.push(await recordProcessTree(daemon.daemonIdentity))
    }
    await shutdownFixtureDaemons(daemonArtifacts, recordedDaemonTrees)
    expect(await anyRecordedProcessIsAlive(recordedDaemonTrees.flat())).toBe(false)
    expect(await processIdentityIsAlive(unrelatedControl.identity)).toBe(true)
    assertionsComplete = true
  } finally {
    adoptedPreviousAdapter?.dispose()
    currentMarker?.adapter.dispose()
    previousMarker?.adapter.dispose()
    for (const daemon of daemonArtifacts) {
      if (!recordedDaemonTrees.some((tree) => tree[0]?.pid === daemon.daemonIdentity.pid)) {
        try {
          recordedDaemonTrees.push(await recordProcessTree(daemon.daemonIdentity))
        } catch {
          // It exited before cleanup tree capture.
        }
      }
    }
    await shutdownFixtureDaemons(daemonArtifacts, recordedDaemonTrees).catch(() => {})
    if (unrelatedControl) {
      await terminateRecordedTree([unrelatedControl.identity]).catch(() => {})
    }
    if (!assertionsComplete) {
      runtime.retainDiagnostics(daemonArtifacts)
    }
    runtime.remove()
  }
}

test.describe.configure({ mode: 'serial' })

test('isolated two-generation fixture reproduces empty legacy daemon persistence', async (// oxlint-disable-next-line no-empty-pattern -- Playwright requires an object fixture argument before testInfo.
{}, testInfo) => {
  await runTwoGenerationReproduction(testInfo, async (runtime) => ({
    entryPath: runtime.currentFixtureEntryPath,
    executablePath: runtime.localElectronExecutablePath,
    source: 'test-owned-protocol'
  }))
})

test('immediate protocol-v22 daemon remains reattachable after protocol-v23 starts', async (// oxlint-disable-next-line no-empty-pattern -- Playwright requires an object fixture argument before testInfo.
{}, testInfo) => {
  expect(PROTOCOL_VERSION).toBe(23)
  await runTwoGenerationReproduction(
    testInfo,
    async (runtime) => ({
      entryPath: runtime.currentFixtureEntryPath,
      executablePath: runtime.localElectronExecutablePath,
      source: 'test-owned-protocol'
    }),
    {
      previousProtocolVersion: 22,
      currentProtocolVersion: 23,
      previousLabel: 'previous-v22',
      currentLabel: 'current-v23'
    }
  )
})

test('empty protocol-v23 daemon exits and removes only its owned artifacts', async (// oxlint-disable-next-line no-empty-pattern -- Playwright requires an object fixture argument before testInfo.
{}, testInfo) => {
  test.setTimeout(60_000)
  expect(PROTOCOL_VERSION).toBe(23)
  const runtime = await createDaemonGenerationRuntime(testInfo)
  let daemon: DaemonGenerationArtifact | null = null
  let assertionsComplete = false

  try {
    daemon = await launchDaemonGeneration({
      runtime,
      label: 'idle-v23',
      protocolVersion: PROTOCOL_VERSION,
      entryPath: runtime.currentFixtureEntryPath,
      executablePath: runtime.localElectronExecutablePath,
      idleShutdownMs: 750
    })
    await assertGenerationArtifacts(daemon)
    expect(daemon.launchNonce).toMatch(/^[0-9a-f-]{36}$/)
    expect(JSON.parse(readFileSync(daemon.pidPath, 'utf8'))).toMatchObject({
      pid: daemon.daemonIdentity.pid,
      launchNonce: daemon.launchNonce
    })

    const exit = await waitForFixtureChildExit(daemon.child)
    expect(exit).toEqual({ code: 0, signal: null })
    await waitForCondition(
      'exact idle daemon incarnation to exit',
      async () => !(await processIdentityIsAlive(daemon!.daemonIdentity))
    )
    expect(existsSync(daemon.pidPath)).toBe(false)
    expect(existsSync(daemon.tokenPath)).toBe(false)
    if (process.platform === 'win32') {
      await waitForCondition('idle daemon named pipe to refuse connections', () =>
        endpointRefusesConnections(daemon!.socketPath)
      )
    } else {
      expect(existsSync(daemon.socketPath)).toBe(false)
    }
    assertionsComplete = true
  } finally {
    if (daemon && (await processIdentityIsAlive(daemon.daemonIdentity))) {
      await terminateRecordedTree(await recordProcessTree(daemon.daemonIdentity)).catch(() => {})
    }
    if (!assertionsComplete && daemon) {
      runtime.retainDiagnostics([daemon])
    }
    runtime.remove()
  }
})

test('official v1.4.139 protocol-v21 daemon remains live and reattachable from v22', async (// oxlint-disable-next-line no-empty-pattern -- Playwright requires an object fixture argument before testInfo.
{}, testInfo) => {
  await runTwoGenerationReproduction(testInfo, async (runtime) => {
    const fixture = await prepareOfficialV21Fixture(runtime)
    return 'skipReason' in fixture
      ? fixture
      : {
          entryPath: fixture.entryPath,
          executablePath: fixture.executablePath,
          source: 'official-v1.4.139'
        }
  })
})

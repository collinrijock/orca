/* eslint-disable max-lines -- Why: this module owns the complete daemon
lifecycle for the Electron main process — init, out-of-process launch,
current+legacy adapter wiring, restart orchestration (the 7-step sequence
from docs/daemon-staleness-ux.md §Phase 1), and teardown on app quit. Splitting
it would scatter the "swap the running provider atomically" invariant across
files with no cleaner ownership seam: restart, replaceDaemonProvider, and the
module-level spawner/adapter singletons must stay co-located so a future
change cannot leave them drifting out of sync. */
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import { mkdirSync, existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { fork } from 'node:child_process'
import { connect } from 'node:net'
import {
  DaemonSpawner,
  getDaemonPidPath,
  getDaemonSocketPath,
  getDaemonTokenPath,
  serializeDaemonPidFile,
  unlinkOwnedDaemonPidFile,
  unlinkOwnedDaemonTokenFile,
  type DaemonLauncher,
  type DaemonProcessHandle
} from './daemon-spawner'
import { DaemonPtyAdapter } from './daemon-pty-adapter'
import { DaemonPtyRouter } from './daemon-pty-router'
import { DaemonClient } from './client'
import {
  PREVIOUS_DAEMON_PROTOCOL_VERSIONS,
  PROTOCOL_VERSION,
  type DaemonEndpointIdentity,
  type ListSessionsResult
} from './types'
import {
  getMacDaemonSystemResolverHealth,
  getDaemonLaunchIdentity,
  getExactDaemonProcessState,
  getProcessStartedAtMs,
  checkDaemonHealth,
  isDaemonStaleForCurrentBundle,
  parseDaemonPidFile
} from './daemon-health'
import {
  collectPinnedDaemonVersions,
  materializeRelocatedDaemonHost,
  pruneOldDaemonHosts
} from './daemon-host-relocation'
import { DegradedDaemonPtyProvider } from './degraded-daemon-pty-provider'
import {
  getLocalPtyProvider,
  setLocalPtyProvider,
  unbindLocalProviderListeners,
  rebindLocalProviderListeners
} from '../ipc/pty'
import { isStartupDiagnosticsEnabled, logStartupDiagnostic } from '../startup/startup-diagnostics'
import { getDaemonLogFilePath } from '../observability/logs-directory'
import {
  confirmSeededClaudeLivePtys,
  hasSeededUnconfirmedClaudePtys
} from '../claude-accounts/live-pty-gate'
import { runDaemonGenerationAudit } from './daemon-generation-audit'
import type { DaemonGenerationDiscovery } from './daemon-generation-inventory'

// Why: daemon init runs concurrently with window load, so harness-side stderr
// arrival times are useless — in-process `t` lets the startup benchmark derive
// how long the daemon cold-start path actually took.
function logDaemonMilestone(event: string, details: Record<string, unknown> = {}): void {
  if (isStartupDiagnosticsEnabled()) {
    logStartupDiagnostic(event, { t: Math.round(performance.now()), ...details })
  }
}

// Why: how many extra hello+listSessions probes to make against a wedged-but-
// connectable daemon before replacing it. Each probe waits out the client's 5s
// hello timeout, so this spaces re-checks ~5s apart: 1 initial + 11 retries ≈
// 60s of grace for a transiently wedged daemon (Windows update-relaunch drain)
// to answer and be preserved WITH its live sessions, before a permanent wedge
// (#8689) is replaced. Deliberately generous to keep live-session loss on the
// transient path as close to zero as possible.
//
// A transient wedge drains early (well under the 60s local-PTY fail-open cap),
// so its startup is short. Only a *permanent* wedge runs the full window; it can
// then approach/exceed the fail-open cap, at which point restored panes fail
// open to the in-process provider for the session and adopt the freshly forked
// daemon on the next launch — a rare path that still recovers, versus the old
// forever-broken behavior. Trade-off: a transient wedge owning live sessions
// that takes longer than ~60s to drain is replaced (live processes lost, though
// scrollback cold-restores). Raise this only alongside the fail-open cap.
export const WEDGED_DAEMON_GRACE_RETRIES = 11

let spawner: DaemonSpawner | null = null
type DaemonProvider = DaemonPtyRouter | DaemonPtyAdapter | DegradedDaemonPtyProvider

let adapter: DaemonProvider | null = null
// Why: coalesce concurrent restartDaemon() calls so two clicks (or a UI
// click racing an internal caller) can't both enter the 7-step sequence —
// the second entry would read the already-disposed current adapter and
// race cleanupDaemonForProtocol against a half-spawned replacement.
let restartInFlight: Promise<RestartDaemonResult> | null = null
const DAEMON_AUDIT_LAUNCH_ID = randomUUID()
let daemonGenerationAuditReleased = false
let pendingDaemonGenerationAudit: {
  userDataPath: string
  runtimeDir: string
  discovery: DaemonGenerationDiscovery
} | null = null

function getRuntimeDir(): string {
  const dir = join(app.getPath('userData'), 'daemon')
  mkdirSync(dir, { recursive: true })
  return dir
}

function getHistoryDir(): string {
  const dir = join(app.getPath('userData'), 'terminal-history')
  mkdirSync(dir, { recursive: true })
  return dir
}

function getDaemonEntryPath(): string {
  const appPath = app.getAppPath()
  // Why: electron-builder unpacks daemon-entry.js so child_process.fork() can
  // execute it from disk. In packaged apps app.getAppPath() points at
  // app.asar, so redirect to the unpacked sibling before joining the script.
  const basePath = app.isPackaged ? appPath.replace('app.asar', 'app.asar.unpacked') : appPath
  const directEntryPath = join(basePath, 'daemon-entry.js')
  if (existsSync(directEntryPath)) {
    return directEntryPath
  }
  return join(basePath, 'out', 'main', 'daemon-entry.js')
}

// Why: the detached daemon writes lifecycle events to a rotated file so field
// failures are diagnosable from a bundle. Honor the same hard privacy switch
// the local trace sink honors (ORCA_DIAGNOSTICS_DISABLED); absence of the arg
// is fully supported, so gating it off is safe and adoption-neutral.
function daemonLogArgs(): string[] {
  const disabled = (process.env.ORCA_DIAGNOSTICS_DISABLED ?? '').trim().toLowerCase()
  if (disabled === '1' || disabled === 'true') {
    return []
  }
  return ['--log-file', getDaemonLogFilePath()]
}

// Why: before spawning a new daemon, check if an existing one is alive by
// attempting a TCP connection to the socket. If it connects, the daemon
// survived from a previous app session — reuse it instead of spawning.
function probeSocket(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32' && !existsSync(socketPath)) {
      resolve(false)
      return
    }
    const sock = connect({ path: socketPath })
    let settled = false
    let timer: ReturnType<typeof setTimeout>
    function finish(alive: boolean, options?: { destroy?: boolean }): void {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      sock.removeListener('connect', onConnect)
      sock.removeListener('error', onError)
      if (options?.destroy) {
        sock.destroy()
      }
      resolve(alive)
    }

    function onConnect(): void {
      finish(true, { destroy: true })
    }

    function onError(): void {
      finish(false)
    }

    timer = setTimeout(() => {
      finish(false, { destroy: true })
    }, 1000)
    sock.on('connect', onConnect)
    sock.on('error', onError)
  })
}

async function getAliveDaemonSessionCount(
  socketPath: string,
  tokenPath: string,
  protocolVersion = PROTOCOL_VERSION
): Promise<number | null> {
  const client = new DaemonClient({ socketPath, tokenPath, protocolVersion })
  try {
    await client.ensureConnected()
    const result = await client.request<ListSessionsResult>('listSessions', undefined)
    return result.sessions.filter((session) => session.isAlive).length
  } catch {
    return null
  } finally {
    client.disconnect()
  }
}

function createPreservedDaemonHandle(
  runtimeDir: string,
  protocolVersion = PROTOCOL_VERSION,
  mode?: 'degraded-new-pty-fallback'
): DaemonProcessHandle {
  const handle: DaemonProcessHandle = {
    shutdown: async () => {
      await cleanupDaemonForProtocol(runtimeDir, protocolVersion)
    }
  }
  if (mode) {
    handle.mode = mode
  }
  return handle
}

async function shouldPreserveDaemonWithLiveSessions(
  socketPath: string,
  tokenPath: string,
  replacementLabel: string
): Promise<boolean> {
  const liveSessionCount = await getAliveDaemonSessionCount(socketPath, tokenPath)
  if (liveSessionCount === 0) {
    return false
  }
  console.warn(
    liveSessionCount === null
      ? `[daemon] Preserving daemon ${replacementLabel} because live session state could not be verified`
      : `[daemon] Preserving daemon ${replacementLabel} because it owns ${liveSessionCount} live session${liveSessionCount === 1 ? '' : 's'}`
  )
  return true
}

function createOutOfProcessLauncher(runtimeDir: string): DaemonLauncher {
  return async (socketPath, tokenPath, suppliedPidPath, suppliedLaunchNonce) => {
    const entryPath = getDaemonEntryPath()
    const pidPath = suppliedPidPath ?? getDaemonPidPath(runtimeDir)
    const launchNonce = suppliedLaunchNonce ?? randomUUID()
    let cleanupResult: OrphanedDaemonCleanupResult | null = null
    const health = await checkDaemonHealth(socketPath, tokenPath)
    if (health === 'healthy') {
      const resolverHealth = await getMacDaemonSystemResolverHealth(socketPath, tokenPath)
      if (resolverHealth === 'unhealthy') {
        const liveSessionCount = await getAliveDaemonSessionCount(socketPath, tokenPath)
        if (liveSessionCount !== 0) {
          console.warn(
            liveSessionCount === null
              ? '[daemon] Preserving daemon with unavailable macOS system resolver because live session state could not be verified'
              : `[daemon] Preserving daemon with unavailable macOS system resolver because it owns ${liveSessionCount} live session${liveSessionCount === 1 ? '' : 's'}`
          )
          return createPreservedDaemonHandle(runtimeDir)
        }
        console.warn('[daemon] Replacing daemon with unavailable macOS system resolver')
        cleanupResult = await cleanupDaemonForProtocol(runtimeDir, PROTOCOL_VERSION)
      } else {
        // Why: a protocol-healthy daemon can outlive the app bundle that
        // launched it. In dev this happens after deleting/rebuilding a
        // worktree; in packaged apps it happens when the stable
        // /Applications/Orca.app path is replaced during update.
        const identity = await getDaemonLaunchIdentity(runtimeDir, socketPath, tokenPath, entryPath)
        const stalePackagedBundle =
          app.isPackaged &&
          (await isDaemonStaleForCurrentBundle(runtimeDir, socketPath, tokenPath, app.getVersion()))
        if (identity === 'mismatch' || stalePackagedBundle) {
          // Why: replacing a healthy daemon kills its child PTYs; defer code
          // freshness until no live terminal sessions would be lost.
          const replacementLabel = stalePackagedBundle
            ? 'launched before the current app bundle was installed'
            : 'launched from a different app path'
          if (await shouldPreserveDaemonWithLiveSessions(socketPath, tokenPath, replacementLabel)) {
            return createPreservedDaemonHandle(runtimeDir)
          }
          console.warn(
            stalePackagedBundle
              ? '[daemon] Replacing daemon launched before the current app bundle was installed'
              : '[daemon] Replacing daemon launched from a different app path'
          )
          cleanupResult = await cleanupDaemonForProtocol(runtimeDir, PROTOCOL_VERSION)
        } else {
          // Why: daemon is already running from a previous app session and
          // responded to a protocol-level ping. Safe to reuse.
          return createPreservedDaemonHandle(runtimeDir)
        }
      }
    } else {
      // Why: a busy machine (e.g. right after an update) can time out the
      // health check while the daemon is alive and owning terminals. Killing
      // it would destroy every live session, so re-verify with a session list
      // first.
      let liveSessionCount = await getAliveDaemonSessionCount(socketPath, tokenPath)
      // Why: on a Windows update relaunch the daemon can be transiently wedged
      // past every RPC budget (final checkpoint flush + installer/AV disk
      // pressure) while its sessions are still alive — replacing it here is what
      // killed those sessions. A pipe that still accepts connections proves a
      // live daemon, so give a wedged-but-connectable daemon a bounded grace to
      // drain and answer before deciding. A PERMANENTLY wedged daemon (accepts
      // connections but its event loop never answers hello — #8689) exhausts the
      // grace and falls through to replacement below, instead of being preserved
      // forever, which strands the app with zero working terminals. 'rejected'
      // means the daemon answered and refused the handshake — it can never be
      // adopted, so it skips the grace and replacement stays the only recovery.
      let graceRetry = 0
      while (
        liveSessionCount === null &&
        health !== 'rejected' &&
        graceRetry < WEDGED_DAEMON_GRACE_RETRIES &&
        (await probeSocket(socketPath))
      ) {
        liveSessionCount = await getAliveDaemonSessionCount(socketPath, tokenPath)
        graceRetry++
      }
      if (liveSessionCount !== null && liveSessionCount > 0) {
        if (health === 'pty-spawn-unhealthy') {
          console.warn(
            `[daemon] DEGRADED MODE: preserving daemon that failed the PTY spawn health check because it owns ${liveSessionCount} live session${liveSessionCount === 1 ? '' : 's'}. Existing sessions keep working; fresh terminals run on the local provider WITHOUT daemon persistence until you restart the daemon (Manage Sessions → Restart).`
          )
          return createPreservedDaemonHandle(
            runtimeDir,
            PROTOCOL_VERSION,
            'degraded-new-pty-fallback'
          )
        }
        console.warn(
          `[daemon] Preserving daemon that failed the health check because it owns ${liveSessionCount} live session${liveSessionCount === 1 ? '' : 's'}`
        )
        return createPreservedDaemonHandle(runtimeDir)
      }
    }

    cleanupResult ??= await cleanupDaemonForProtocol(runtimeDir, PROTOCOL_VERSION)
    if (cleanupResult.shutdownAttempted && !cleanupResult.cleaned) {
      // Why: a sent signal or failed RPC is not exact process absence; forking
      // here could overlap the old daemon or erase a replacement endpoint.
      throw new Error('Unable to verify stale daemon shutdown')
    }

    const userDataPath = app.getPath('userData')
    // Why: on win32 packaged, fork from a copy of the Electron runtime staged
    // in userData so the daemon's image + loaded modules escape the install dir
    // the NSIS updater deletes and force-closes. Staged here (not at app start)
    // so the one-time copy stays off the first-paint path and is skipped on
    // launches that adopt a live daemon. Fail-open: null → in-dir host, below.
    const relocatedHost = materializeRelocatedDaemonHost()
    // Fork the relocated entry when available; otherwise the install-dir entry.
    const forkEntryPath = relocatedHost ? relocatedHost.entryPath : entryPath
    const child = fork(
      forkEntryPath,
      [
        '--socket',
        socketPath,
        '--token',
        tokenPath,
        '--pid-record',
        pidPath,
        '--launch-nonce',
        launchNonce,
        ...daemonLogArgs()
      ],
      {
        // Why: detached daemons can outlive dev worktrees. Starting from
        // userData keeps process.cwd() valid after a repo/worktree is deleted.
        cwd: userDataPath,
        // Why: detached + unref lets the daemon outlive the Electron process.
        // stdout stays 'ignore' so the child never holds the parent's stdout
        // open (which would block Electron exit); stderr is 'pipe' so a
        // module-load crash during startup is captured instead of discarded
        // (v1.4.129-rc.1 shipped a daemon that only logged "exited with code 1"
        // because stderr was thrown away). The pipe is destroyed on readiness.
        detached: true,
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        // Why: run the relocated Orca.exe copy instead of the install-dir one.
        // It is byte-identical, so run-as-node behavior is unchanged; only the
        // image path moves out of the updater's kill zone.
        ...(relocatedHost ? { execPath: relocatedHost.execPath } : {}),
        // Why: ELECTRON_RUN_AS_NODE makes the forked process run as a plain
        // Node.js process instead of an Electron renderer/main process. Without
        // it, Electron's GPU/display initialization can interfere with native
        // module operations like node-pty's posix_spawn of the spawn-helper.
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
          // Why: the detached daemon is plain Node and cannot call Electron's
          // app.getPath(), but shell-ready rcfiles must live outside swept tmp.
          ORCA_USER_DATA_PATH: userDataPath
        }
      }
    )

    // Why: keep only the startup-window stderr tail so a crash cause is
    // visible without unbounded memory if the daemon spews before dying.
    const STARTUP_STDERR_MAX_BYTES = 8192
    let startupStderr = ''
    let collectingStderr = true
    const onStartupStderr = (chunk: Buffer): void => {
      if (!collectingStderr) {
        return
      }
      startupStderr += chunk.toString('utf8')
      if (startupStderr.length > STARTUP_STDERR_MAX_BYTES) {
        startupStderr = startupStderr.slice(-STARTUP_STDERR_MAX_BYTES)
      }
    }
    child.stderr?.on('data', onStartupStderr)
    // Why: once the daemon is up (or has failed) the parent must not keep a
    // live handle on the detached daemon's stderr — a piped stream would ref
    // the parent event loop and prevent Electron from exiting cleanly.
    const releaseStderr = (): void => {
      collectingStderr = false
      child.stderr?.off('data', onStartupStderr)
      child.stderr?.destroy()
    }

    // Wait for the daemon to signal readiness via IPC
    await new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      let settled = false
      function cleanupStartupListeners(): void {
        if (timer) {
          clearTimeout(timer)
        }
        child.off('message', onReadyMessage)
        child.off('error', onStartupError)
        child.off('exit', onStartupExit)
      }
      function fail(error: Error): void {
        if (settled) {
          return
        }
        settled = true
        cleanupStartupListeners()
        // Why: stderr was previously discarded, so a startup crash surfaced only
        // as "exited with code 1". Attach the captured tail to the thrown error
        // (which the fallback path reports) and log it so the real cause shows.
        const stderrTail = startupStderr.trim()
        if (stderrTail) {
          console.warn(`[daemon] startup failed; captured stderr tail:\n${stderrTail}`)
        }
        releaseStderr()
        if (child.pid) {
          try {
            process.kill(child.pid, 'SIGTERM')
          } catch {
            // Already dead
          }
        }
        reject(
          stderrTail ? new Error(`${error.message}\nDaemon stderr (tail):\n${stderrTail}`) : error
        )
      }
      function onReadyMessage(msg: unknown): void {
        if (msg && typeof msg === 'object' && (msg as { type?: string }).type === 'ready') {
          if (settled) {
            return
          }
          settled = true
          // Why: the daemon process is detached after readiness; leaving
          // startup listeners attached retains this launch promise closure.
          cleanupStartupListeners()
          if (child.pid) {
            // Why: the endpoint hello reports this same self timestamp, so the
            // PID record must prefer it; OS probes round differently by platform.
            // The process-recycling guard tolerates that value against OS time.
            const selfReported = (msg as { startedAtMs?: unknown }).startedAtMs
            writeFileSync(
              pidPath,
              serializeDaemonPidFile({
                pid: child.pid,
                startedAtMs:
                  typeof selfReported === 'number' && Number.isFinite(selfReported)
                    ? selfReported
                    : getProcessStartedAtMs(child.pid),
                entryPath,
                appVersion: app.getVersion(),
                launchNonce
              }),
              { mode: 0o600 }
            )
          }
          // Why: disconnect IPC channel, release the stderr pipe, and unref so
          // Electron can exit without waiting for the daemon. The daemon keeps
          // running detached.
          releaseStderr()
          child.disconnect()
          child.unref()
          resolve()
        }
      }

      function onStartupError(err: Error): void {
        fail(err)
      }

      function onStartupExit(code: number | null): void {
        fail(new Error(`Daemon exited during startup with code ${code}`))
      }

      timer = setTimeout(() => {
        fail(new Error('Daemon startup timed out'))
      }, 10000)

      child.on('message', onReadyMessage)
      child.on('error', onStartupError)
      child.on('exit', onStartupExit)
    })

    return {
      shutdown: async () => {
        if (child.pid) {
          try {
            process.kill(child.pid, 'SIGTERM')
          } catch {
            // Already dead
          }
        }
      }
    }
  }
}

export async function initDaemonPtyProvider(signal?: AbortSignal): Promise<void> {
  logDaemonMilestone('daemon-init-start')
  // Why: e2e coverage for the startup PTY gate (#5232) needs a daemon init
  // that deterministically outlasts the first-window timeout. Real triggers
  // (stale-daemon cleanup, legacy probes on a busy disk) are not controllable
  // from a test.
  const e2eInitDelayMs = Number(process.env.ORCA_E2E_DAEMON_INIT_DELAY_MS)
  if (Number.isFinite(e2eInitDelayMs) && e2eInitDelayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, e2eInitDelayMs))
  }
  const runtimeDir = getRuntimeDir()

  const newSpawner = new DaemonSpawner({
    runtimeDir,
    launcher: createOutOfProcessLauncher(runtimeDir)
  })

  // Why: assign spawner/adapter only after both succeed. If ensureRunning()
  // throws, a stale spawner would prevent shutdownDaemon() from cleaning up
  // correctly on retry.
  const info = await newSpawner.ensureRunning()
  // Reclaim superseded daemon-host copies on EVERY launch, not just on a fresh
  // spawn: surviving daemons make spawns rare, so a spawn-only sweep would let
  // old-version copies accumulate. Current + live-daemon-pinned versions stay.
  pruneOldDaemonHosts(collectPinnedDaemonVersions(runtimeDir))
  const launchMode = newSpawner.getHandle()?.mode
  logDaemonMilestone('daemon-current-ready')
  if (signal?.aborted) {
    // Why: startup fail-open may already have allowed fallback LocalPtyProvider
    // PTYs to spawn. A late daemon swap would strand those PTYs on the old owner.
    return
  }

  const newAdapter = new DaemonPtyAdapter({
    socketPath: info.socketPath,
    tokenPath: info.tokenPath,
    historyPath: getHistoryDir(),
    // Why: when the daemon process dies (e.g. killed by a signal, OOM, or
    // cascading from a force-quit of child processes), the adapter's
    // ensureConnected() detects the dead socket and calls this to fork a
    // replacement daemon before retrying the connection.
    respawn: async () => {
      console.warn('[daemon] Daemon process died — respawning')
      newSpawner.resetHandle()
      await newSpawner.ensureRunning()
    }
  })

  const legacyDiscovery = await createLegacyDaemonAdapters(runtimeDir)
  const legacyAdapters = legacyDiscovery.adapters
  const routedAdapter =
    launchMode === 'degraded-new-pty-fallback'
      ? new DegradedDaemonPtyProvider({
          current: newAdapter,
          legacy: legacyAdapters,
          fallback: getLocalPtyProvider()
        })
      : legacyAdapters.length > 0
        ? new DaemonPtyRouter({
            current: newAdapter,
            legacy: legacyAdapters
          })
        : newAdapter
  let discovery: DaemonGenerationDiscovery = { generations: [], failedProtocols: [] }
  if (routedAdapter instanceof DegradedDaemonPtyProvider) {
    // Why: the preserved daemon cannot create fresh terminals, but its live
    // sessions may still be writable. Discover those ids so only known old
    // sessions route to the degraded daemon; fresh panes fall back locally.
    discovery = await routedAdapter.discoverDaemonSessions()
    // Why: a degraded current daemon stays usable for adoption, but its inventory is
    // keep-only and must never mature audit evidence.
    discovery.failedProtocols.push(newAdapter.protocolVersion)
  } else if (routedAdapter instanceof DaemonPtyRouter) {
    discovery = await routedAdapter.discoverDaemonSessions()
  } else {
    try {
      discovery.generations.push({
        adapter: newAdapter,
        protocolVersion: newAdapter.protocolVersion,
        sessions: await newAdapter.listSessions()
      })
    } catch {
      discovery.failedProtocols.push(newAdapter.protocolVersion)
    }
  }
  discovery.failedProtocols.push(...legacyDiscovery.failedProtocols)
  if (signal?.aborted) {
    // Why: same late-swap guard after legacy discovery, which can also exceed
    // the first-window startup timeout on slow or stale daemon state.
    return
  }

  spawner = newSpawner
  adapter = routedAdapter
  setLocalPtyProvider(routedAdapter)
  // Why: desktop startup now lets the first window register PTY listeners
  // before daemon init finishes. Rebind here so daemon PTYs still fan out
  // data/exit events through the renderer and runtime listeners.
  rebindLocalProviderListeners()
  logDaemonMilestone('daemon-init-done', { legacyAdapters: legacyAdapters.length })
  reconcileSeededClaudeLivePtys(discovery)
  pendingDaemonGenerationAudit =
    discovery.generations.length > 0 || discovery.failedProtocols.length > 0
      ? { userDataPath: app.getPath('userData'), runtimeDir, discovery }
      : null
  scheduleReleasedDaemonGenerationAudit()
}

export function releaseDaemonGenerationAudit(): void {
  daemonGenerationAuditReleased = true
  scheduleReleasedDaemonGenerationAudit()
}

function scheduleReleasedDaemonGenerationAudit(): void {
  if (!daemonGenerationAuditReleased || !pendingDaemonGenerationAudit) {
    return
  }
  const pending = pendingDaemonGenerationAudit
  pendingDaemonGenerationAudit = null
  // Why: disk and process inventory starts only after desktop first-window
  // release, or the equivalent headless provider-ready boundary.
  setImmediate(() => {
    void runDaemonGenerationAudit({
      ...pending,
      launchId: DAEMON_AUDIT_LAUNCH_ID
    })
      .then((result) => {
        const details = {
          status: result.status,
          reasons: result.reasons,
          generations: result.generationCount,
          initialSessions: result.initialSessionCount,
          stableSessions: result.stableSessionCount,
          unclaimedSessions: result.unclaimedCount,
          emptyLegacyGenerations: result.emptyLegacyGenerationCount,
          journalStatus: result.journal.status,
          journalReason: result.journal.reason
        }
        console.info('[daemon] generation audit', details)
        logDaemonMilestone('daemon-generation-audit', details)
      })
      .catch(() => {
        const details = { status: 'incomplete', reasons: ['unexpected-audit-failure'] }
        console.info('[daemon] generation audit', details)
        logDaemonMilestone('daemon-generation-audit', details)
      })
  })
}

// Why: the Claude live-PTY gate is seeded pessimistically from persistence at
// store load. Once the daemon is up we know which of those sessions actually
// survived — release dead ids so they cannot defer OAuth refresh forever.
// Listing failures keep the seeds: over-holding the gate only delays a usage
// refresh, while releasing it early can rotate a live CLI's refresh token.
function reconcileSeededClaudeLivePtys(discovery: DaemonGenerationDiscovery): void {
  if (!hasSeededUnconfirmedClaudePtys()) {
    return
  }
  if (discovery.failedProtocols.length > 0) {
    console.warn('[daemon] Keeping seeded Claude live-PTY gate — session listing failed')
    return
  }
  confirmSeededClaudeLivePtys(
    discovery.generations.flatMap(({ sessions }) => sessions.map((session) => session.sessionId))
  )
}

// Why: the Manage Sessions IPC handlers need read access to the current
// adapter/router to list sessions, kill them, etc. Exposed as a narrow getter
// rather than exporting the module-level variable to keep the "swap on
// restart" invariant in one place (replaceDaemonProvider).
export function getDaemonProvider(): DaemonProvider | null {
  return adapter
}

// Why: the "Restart daemon" flow rebuilds the current-protocol adapter and
// must update both the module-level `adapter` singleton here and the
// `localProvider` reference inside ipc/pty.ts. Without this helper they could
// drift — app-quit would dispose a stale adapter reference.
export function replaceDaemonProvider(newAdapter: DaemonProvider): void {
  adapter = newAdapter
  setLocalPtyProvider(newAdapter)
}

function getCurrentDaemonAdapter(provider: DaemonProvider): DaemonPtyAdapter {
  if (provider instanceof DaemonPtyRouter || provider instanceof DegradedDaemonPtyProvider) {
    return provider.getCurrentAdapter()
  }
  return provider
}

function getLegacyDaemonAdapters(provider: DaemonProvider): DaemonPtyAdapter[] {
  if (provider instanceof DaemonPtyRouter || provider instanceof DegradedDaemonPtyProvider) {
    return [...provider.getLegacyAdapters()]
  }
  return []
}

function disposeProviderSubscriptionsOnly(provider: DaemonProvider): void {
  if (provider instanceof DaemonPtyRouter) {
    provider.disposeRouterOnly()
    return
  }
  if (provider instanceof DegradedDaemonPtyProvider) {
    provider.disposeProviderOnly()
  }
}

export type RestartDaemonResult = {
  killedCount: number
}

// Why: the 7-step sequence from docs/daemon-staleness-ux.md §Phase 1 restart.
// Current-protocol only — legacy adapters are preserved and route to their
// original daemons with no respawn path. See the design doc for rationale on
// each step, notably why synthetic exits must fan out *before* the listener
// unsubscribe.
export async function restartDaemon(): Promise<RestartDaemonResult> {
  if (restartInFlight) {
    return restartInFlight
  }
  restartInFlight = runRestartDaemon().finally(() => {
    restartInFlight = null
  })
  return restartInFlight
}

async function runRestartDaemon(): Promise<RestartDaemonResult> {
  const currentSpawner = spawner
  const currentAdapter = adapter
  if (!currentSpawner || !currentAdapter) {
    throw new Error('restartDaemon called before initDaemonPtyProvider')
  }

  const runtimeDir = getRuntimeDir()
  const currentOnly = getCurrentDaemonAdapter(currentAdapter)
  const legacyAdapters = getLegacyDaemonAdapters(currentAdapter)

  // Step 1: fence new create/attach work, drain admitted operations, then capture
  // every current session while its exact routes still exist.
  const capturedCurrentSessionIds =
    currentAdapter instanceof DegradedDaemonPtyProvider
      ? await currentAdapter.beginRestartFence()
      : await currentOnly.beginRestartFence()
  const fallbackShutdown =
    currentAdapter instanceof DegradedDaemonPtyProvider
      ? await currentAdapter.shutdownFallbackSessions()
      : { stoppedIds: [], failedIds: [] }
  if (fallbackShutdown.failedIds.length > 0) {
    // Why: swapping providers after an unverified fallback stop would strand
    // a live PTY without a route, so preserve the degraded provider for retry.
    cancelRestartFence(currentAdapter, currentOnly)
    throw new Error('Unable to verify fallback session shutdown')
  }
  const currentDaemonSessionIds =
    currentAdapter instanceof DegradedDaemonPtyProvider
      ? currentAdapter.getCurrentDaemonSessionIds()
      : []
  const currentDaemonKilledCount = new Set([
    ...capturedCurrentSessionIds,
    ...currentDaemonSessionIds
  ]).size
  const killedCount = currentDaemonKilledCount + fallbackShutdown.stoppedIds.length
  // Step 2: kill the current-protocol daemon process (shutdown RPC → fallback
  // killStaleDaemon → socket/pid unlink). Legacy adapters untouched.
  let cleanup: OrphanedDaemonCleanupResult
  try {
    cleanup = await cleanupDaemonForProtocol(runtimeDir, PROTOCOL_VERSION)
  } catch (error) {
    cancelRestartFence(currentAdapter, currentOnly)
    throw error
  }
  if (!cleanup.cleaned && (cleanup.shutdownAttempted || currentDaemonKilledCount > 0)) {
    // Why: an unreachable endpoint is not proof its sessions stopped. Keep routes
    // and durable claims intact instead of emitting an authoritative restart exit.
    cancelRestartFence(currentAdapter, currentOnly)
    throw new Error('Unable to verify daemon session shutdown')
  }

  // Step 3: only now is the synthetic exit physically verified. Fan out while
  // listeners and old routes are still attached, then detach before replacement.
  currentOnly.fanoutSyntheticExits(-1, { verifiedAbsent: true })
  if (currentAdapter instanceof DegradedDaemonPtyProvider) {
    currentAdapter.fanoutCurrentDaemonSyntheticExits(-1)
  }
  unbindLocalProviderListeners()

  // Step 4: reuse the existing spawner so the respawn closure baked into
  // long-lived adapters stays valid. Do NOT construct a new DaemonSpawner.
  let newCurrent: DaemonPtyAdapter | null = null
  let newProvider: DaemonProvider | null = null
  try {
    currentSpawner.resetHandle()
    const info = await currentSpawner.ensureRunning()

    // Step 5: build a fresh current adapter against the respawned daemon. Its
    // respawn callback closes over the same spawner instance (identical to the
    // crash-respawn closure in initDaemonPtyProvider).
    newCurrent = new DaemonPtyAdapter({
      socketPath: info.socketPath,
      tokenPath: info.tokenPath,
      historyPath: getHistoryDir(),
      respawn: async () => {
        console.warn('[daemon] Daemon process died — respawning')
        currentSpawner.resetHandle()
        await currentSpawner.ensureRunning()
      }
    })

    // Re-wrap in router if there were legacy adapters at startup; otherwise
    // point straight at the new adapter. Legacy instances are preserved by
    // reference — they still route to the same pre-upgrade daemons.
    newProvider =
      legacyAdapters.length > 0
        ? new DaemonPtyRouter({ current: newCurrent, legacy: legacyAdapters })
        : newCurrent
    if (newProvider instanceof DaemonPtyRouter) {
      await newProvider.discoverLegacySessions()
    }
  } catch (error) {
    if (newProvider instanceof DaemonPtyRouter) {
      newProvider.disposeRouterOnly()
    }
    newCurrent?.dispose()
    cancelRestartFence(currentAdapter, currentOnly)
    rebindLocalProviderListeners()
    throw error
  }

  // Why: drain the outgoing router's subscriptions from the shared legacy
  // adapters before installing the new router (which subscribes fresh). Must
  // run *after* the new provider exists so no adapter event is unhandled in
  // the narrow window, and *before* replaceDaemonProvider so the swap is
  // atomic from the renderer's perspective. Plain dispose() would also tear
  // down the legacy adapters themselves — use the router-only variant.
  disposeProviderSubscriptionsOnly(currentAdapter)
  // Why: only legacy adapters cross the swap. The outgoing current adapter's
  // timers, client, and history manager otherwise survive every manual restart.
  currentOnly.dispose()

  // Step 6: swap module state (adapter + localProvider) atomically.
  replaceDaemonProvider(newProvider)

  // Step 7: rebind renderer listeners against the new provider.
  rebindLocalProviderListeners()

  return { killedCount }
}

function cancelRestartFence(provider: DaemonProvider, current: DaemonPtyAdapter): void {
  if (provider instanceof DegradedDaemonPtyProvider) {
    provider.cancelRestartFence()
  } else {
    current.cancelRestartFence()
  }
}

// Why: disconnect from the daemon without killing it. The daemon runs as a
// separate process and survives app quit — sessions stay alive for warm
// reattach on next launch. Leave history sessions marked "unclean" here so a
// later daemon crash while Orca is closed is still recoverable on next launch.
export async function disconnectDaemon(): Promise<void> {
  await adapter?.disconnectOnly()
  adapter = null
}

/** Kill the daemon and all its sessions. Use for full cleanup only. */
export async function shutdownDaemon(): Promise<void> {
  adapter?.dispose()
  adapter = null
  await spawner?.shutdown()
  spawner = null
}

export type OrphanedDaemonCleanupResult = {
  /** True when the captured daemon incarnation is verified absent. False on a
   *  fresh/no-daemon path or whenever replacement safety remains unknown. */
  cleaned: boolean
  /** Distinguishes a fresh/no-daemon path from daemon state that required exact verification. */
  shutdownAttempted: boolean
  /** Number of live PTY sessions killed during cleanup. The caller surfaces this
   *  to the user so they know what background work was stopped. */
  killedCount: number
}

export async function cleanupDaemonForProtocol(
  runtimeDir: string,
  protocolVersion: number
): Promise<OrphanedDaemonCleanupResult> {
  const socketPath = getDaemonSocketPath(runtimeDir, protocolVersion)
  const tokenPath = getDaemonTokenPath(runtimeDir, protocolVersion)
  const pidPath = getDaemonPidPath(runtimeDir, protocolVersion)

  const pidRecordExists = existsSync(pidPath)
  const shutdownPid = readDaemonPidRecord(pidPath)
  const alive = await probeSocket(socketPath)
  if (!alive) {
    if (!pidRecordExists) {
      if (
        process.platform !== 'win32' &&
        existsSync(socketPath) &&
        !(await probeSocket(socketPath)) &&
        !existsSync(pidPath)
      ) {
        // Why: a crashed pre-ready daemon can leave only its Unix socket. The
        // second probe narrows the bind race until namespace coordination ships.
        if (!removeStaleUnixSocket(socketPath)) {
          return { cleaned: false, shutdownAttempted: true, killedCount: 0 }
        }
      }
      return { cleaned: false, shutdownAttempted: false, killedCount: 0 }
    }
    if (
      !shutdownPid ||
      (protocolVersion >= 23 &&
        (shutdownPid.startedAtMs === null || typeof shutdownPid.launchNonce !== 'string'))
    ) {
      // Why: a dead endpoint beside unreadable or incomplete v23 identity is
      // still an overlap risk; fail closed instead of forking over that process.
      return { cleaned: false, shutdownAttempted: true, killedCount: 0 }
    }
    const didVerifyShutdown = await terminateExactDaemon(shutdownPid, socketPath, tokenPath)
    if (!didVerifyShutdown || (await probeSocket(socketPath))) {
      return { cleaned: false, shutdownAttempted: true, killedCount: 0 }
    }
    if (!removeStaleUnixSocket(socketPath)) {
      // Why: exact process absence makes its leftover Unix endpoint stale;
      // leaving it would make the verified-safe replacement fail EADDRINUSE.
      return { cleaned: false, shutdownAttempted: true, killedCount: 0 }
    }
    if (shutdownPid.launchNonce) {
      unlinkOwnedDaemonPidFile(pidPath, shutdownPid.pid, shutdownPid.launchNonce)
    }
    return { cleaned: true, shutdownAttempted: true, killedCount: 0 }
  }

  // Why: only a token captured before authenticating this exact endpoint can
  // later be claimed safely; a token read after exit may belong to a replacement.
  const authenticatedTokenCandidate =
    protocolVersion >= 23 ? readDaemonTokenForCleanup(tokenPath) : null
  const client = new DaemonClient({ socketPath, tokenPath, protocolVersion })
  let killedCount = 0
  let didVerifyShutdown = false
  let authenticatedToken: string | null = null
  try {
    await client.ensureConnected()
    const endpointIdentity = client.getDaemonIdentity()
    if (protocolVersion >= 23 && !daemonEndpointMatchesPidRecord(endpointIdentity, shutdownPid)) {
      // Why: the socket and pid file can be replaced independently; shutdown
      // authority requires both to identify the same daemon incarnation.
      return { cleaned: false, shutdownAttempted: true, killedCount: 0 }
    }
    if (protocolVersion >= 23 && authenticatedTokenCandidate) {
      authenticatedToken = authenticatedTokenCandidate
    }
    const sessions = await client
      .request<ListSessionsResult>('listSessions', undefined)
      .catch(() => ({ sessions: [] }))
    killedCount = sessions.sessions.filter((s) => s.isAlive).length

    // Why: the daemon exposes a single-shot `shutdown` RPC (daemon-server.ts)
    // that kills every session and then terminates its own process. Using it
    // avoids the race between per-session `kill` calls and the daemon exiting.
    await client.request('shutdown', { killSessions: true })
    if (shutdownPid) {
      didVerifyShutdown = await waitForExactDaemonExit(shutdownPid, socketPath, tokenPath)
    }
    if (!didVerifyShutdown) {
      didVerifyShutdown = shutdownPid
        ? await terminateExactDaemon(shutdownPid, socketPath, tokenPath)
        : false
    }
  } catch {
    // Why: canonical pid/socket files may already belong to a replacement;
    // fallback termination stays bound to the incarnation captured pre-RPC.
    didVerifyShutdown = shutdownPid
      ? await terminateExactDaemon(shutdownPid, socketPath, tokenPath)
      : false
  } finally {
    client.disconnect()
  }

  if (didVerifyShutdown && (await probeSocket(socketPath))) {
    // Why: a replacement can bind the canonical endpoint after the captured
    // daemon exits; its same-id sessions make old-generation exits non-authoritative.
    didVerifyShutdown = false
  }

  if (didVerifyShutdown && !removeStaleUnixSocket(socketPath)) {
    // Why: verified process exit is insufficient startup readiness while its
    // Unix endpoint still blocks the canonical bind path.
    didVerifyShutdown = false
  }

  if (didVerifyShutdown && shutdownPid?.launchNonce) {
    // Why: claim-and-validate cleanup cannot unlink a replacement pid record.
    unlinkOwnedDaemonPidFile(pidPath, shutdownPid.pid, shutdownPid.launchNonce)
  }
  if (didVerifyShutdown && authenticatedToken) {
    unlinkOwnedDaemonTokenFile(tokenPath, authenticatedToken)
  }

  return { cleaned: didVerifyShutdown, shutdownAttempted: true, killedCount }
}

function readDaemonTokenForCleanup(tokenPath: string): string | null {
  try {
    return readFileSync(tokenPath, 'utf8').trim() || null
  } catch {
    return null
  }
}

function removeStaleUnixSocket(socketPath: string): boolean {
  if (process.platform === 'win32' || !existsSync(socketPath)) {
    return true
  }
  try {
    unlinkSync(socketPath)
    return true
  } catch {
    return !existsSync(socketPath)
  }
}

function readDaemonPidRecord(pidPath: string): ReturnType<typeof parseDaemonPidFile> {
  try {
    return parseDaemonPidFile(readFileSync(pidPath, 'utf8'))
  } catch {
    return null
  }
}

function daemonEndpointMatchesPidRecord(
  endpoint: DaemonEndpointIdentity | null,
  pidRecord: ReturnType<typeof parseDaemonPidFile>
): boolean {
  return (
    endpoint !== null &&
    pidRecord !== null &&
    typeof pidRecord.launchNonce === 'string' &&
    endpoint.pid === pidRecord.pid &&
    endpoint.startedAtMs === pidRecord.startedAtMs &&
    endpoint.launchNonce === pidRecord.launchNonce
  )
}

async function waitForExactDaemonExit(
  identity: NonNullable<ReturnType<typeof parseDaemonPidFile>>,
  socketPath: string,
  tokenPath: string
): Promise<boolean> {
  const deadline = Date.now() + 3_000
  do {
    const state = await getExactDaemonProcessState(
      identity.pid,
      socketPath,
      tokenPath,
      identity.startedAtMs,
      identity.launchNonce ?? null
    )
    if (state === 'absent') {
      return true
    }
    if (state === 'unknown') {
      return false
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  } while (Date.now() < deadline)
  return false
}

async function terminateExactDaemon(
  identity: NonNullable<ReturnType<typeof parseDaemonPidFile>>,
  socketPath: string,
  tokenPath: string
): Promise<boolean> {
  const initial = await getExactDaemonProcessState(
    identity.pid,
    socketPath,
    tokenPath,
    identity.startedAtMs,
    identity.launchNonce ?? null
  )
  if (initial === 'absent') {
    return true
  }
  if (initial !== 'alive') {
    return false
  }
  try {
    process.kill(identity.pid, 'SIGTERM')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
      return true
    }
    return false
  }
  if (await waitForExactDaemonExit(identity, socketPath, tokenPath)) {
    return true
  }
  if (
    (await getExactDaemonProcessState(
      identity.pid,
      socketPath,
      tokenPath,
      identity.startedAtMs,
      identity.launchNonce ?? null
    )) !== 'alive'
  ) {
    return false
  }
  try {
    process.kill(identity.pid, 'SIGKILL')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
      return true
    }
    return false
  }
  // Why: signal delivery is not process absence; verified exits wait for the
  // captured incarnation to disappear before claims or routes are removed.
  return waitForExactDaemonExit(identity, socketPath, tokenPath)
}

function legacyDaemonProcessState(
  runtimeDir: string,
  protocolVersion: number
): 'alive' | 'absent' | 'unknown' {
  try {
    const parsed = parseDaemonPidFile(
      readFileSync(getDaemonPidPath(runtimeDir, protocolVersion), 'utf8')
    )
    if (!parsed) {
      return 'unknown'
    }
    process.kill(parsed.pid, 0)
    return 'alive'
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH' ? 'absent' : 'unknown'
  }
}

async function createLegacyDaemonAdapters(runtimeDir: string): Promise<{
  adapters: DaemonPtyAdapter[]
  failedProtocols: number[]
}> {
  const adapters: DaemonPtyAdapter[] = []
  const failedProtocols: number[] = []
  for (const protocolVersion of PREVIOUS_DAEMON_PROTOCOL_VERSIONS) {
    const socketPath = getDaemonSocketPath(runtimeDir, protocolVersion)
    const tokenPath = getDaemonTokenPath(runtimeDir, protocolVersion)
    if (!(await probeSocket(socketPath))) {
      // Why: dead legacy daemons leave pid/token files behind forever (one per
      // protocol bump). A stale pid eventually gets recycled by an unrelated
      // process, turning any future identity check into a PowerShell spawn.
      // Only clean up when the pid-file process is provably gone: a live
      // legacy daemon can transiently fail the 1s probe right after an update
      // (wedged event loop, exhausted pipe backlog), and deleting its token
      // file would make its sessions permanently unadoptable.
      const processState = legacyDaemonProcessState(runtimeDir, protocolVersion)
      if (processState === 'absent') {
        for (const stalePath of [
          getDaemonPidPath(runtimeDir, protocolVersion),
          getDaemonTokenPath(runtimeDir, protocolVersion)
        ]) {
          try {
            unlinkSync(stalePath)
          } catch {
            // Best-effort
          }
        }
        if (process.platform !== 'win32' && existsSync(socketPath)) {
          try {
            unlinkSync(socketPath)
          } catch {
            // Best-effort
          }
        }
      } else {
        // Why: a live PID beside an unreachable endpoint is an unknown generation,
        // not evidence that the shared namespace was completely enumerated.
        failedProtocols.push(protocolVersion)
      }
      continue
    }
    // Why: old daemon PTYs can be running long-lived agents during an app
    // upgrade. Keep those sessions routed to their original daemon while new
    // terminals use the current protocol, instead of killing background work.
    // Legacy adapters intentionally do not respawn: respawning an old protocol
    // daemon from new code would recreate stale env semantics and can be less
    // predictable than letting the session fail if that old daemon dies.
    // Why historyPath is still passed: checkpoint writes will fail silently
    // (pre-v4 daemons don't support getSnapshot), but the HistoryManager is
    // still needed for cleanup — close/exit events must remove history dirs
    // and mark meta.json as ended. Without it, a later v4 session reusing
    // the same ID could false-restore stale scrollback.bin.
    adapters.push(
      new DaemonPtyAdapter({
        socketPath,
        tokenPath,
        protocolVersion,
        historyPath: getHistoryDir()
      })
    )
  }
  return { adapters, failedProtocols }
}

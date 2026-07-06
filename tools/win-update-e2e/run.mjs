// win-update-e2e — packaged NSIS update proof harness.
//
// Given two Orca Windows installers (version N and N+1), proves what happens to
// the terminal daemon and its sessions across a real silent update, with
// machine-checkable assertions. Windows-only. See README.md for usage and the
// design context in docs/windows-terminal-update-survival-plan.md (Phase 0).

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { assertWin32 } from './platform-guard.mjs'
import { parseArgs } from './cli-args.mjs'
import { preflight } from './preflight.mjs'
import { resolveInstaller, silentInstall, silentUninstall } from './installer-steps.mjs'
import {
  launchInstalledApp,
  waitForTerminalReady,
  createTerminalTab,
  listTabIds,
  startMarker,
  readTerminalTextBestEffort,
  closeApp
} from './app-driver.mjs'
import { readDaemonPidFiles, findDaemonProcesses, isPidAlive } from './daemon-processes.mjs'
import { startWatch } from './window-watch.mjs'
import {
  probeEcho,
  probeHeartbeatAdvancing,
  probeCtrlCInterruptsMarker,
  probeCtrlCOnFreshLoop,
  fileMtimeMs
} from './interactivity-probes.mjs'
import { buildAssertions, renderTable, allPassed } from './assertions.mjs'

function log(step, msg) {
  console.log(`[win-update-e2e] ${step}: ${msg}`)
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) {
    console.log(opts.usage)
    return 0
  }
  if (opts.errors?.length) {
    console.error(`Argument errors:\n  - ${opts.errors.join('\n  - ')}\n${opts.usage}`)
    return 2
  }
  assertWin32('win-update-e2e')

  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const canary = `ORCA-E2E-CANARY-${runId}`
  const runDir = mkdtempSync(path.join(tmpdir(), `orca-win-update-e2e-${runId}-`))
  const userDataDir = path.join(runDir, 'userData')
  const baselinePath = path.join(runDir, 'baseline.json')
  const watchOut = path.join(runDir, 'window-watch.jsonl')
  const markerPidFile = path.join(runDir, 'marker.pid')
  const heartbeatFile = path.join(runDir, 'heartbeat.txt')
  const created = { markerPid: null, daemonPids: new Set() }

  log('setup', `runId=${runId} runDir=${runDir} profile=${opts.expect}`)

  const { warnings, existingInstall } = preflight({
    baselinePath,
    allowExistingInstall: opts.allowExistingInstall
  })
  const hadPreexistingInstall = Boolean(existingInstall)
  for (const w of warnings) {
    log('preflight-warning', w)
  }

  const fromInstaller = resolveInstaller({
    localPath: opts.from,
    releaseTag: opts.fromRelease,
    assetPattern: opts.assetPattern
  })
  log('install-base', `installing ${fromInstaller}`)
  const base = silentInstall(fromInstaller)
  log('install-base', `installed ${base.exePath} (version ${base.version})`)

  // --- Base version: launch, create sessions, start marker, record daemon ---
  let session = await launchInstalledApp({ exePath: base.exePath, userDataDir })
  await waitForTerminalReady(session.page)
  await createTerminalTab(session.page)
  const tabIds = await listTabIds(session.page)
  log('sessions', `tab ids: ${tabIds.join(', ')}`)

  await startMarker(session.page, { canary, pidFile: markerPidFile, heartbeatFile })
  const markerLive = await probeHeartbeatAdvancing(heartbeatFile)
  created.markerPid = readIntFile(markerPidFile)
  log('marker', `pid=${created.markerPid} heartbeatAdvancing=${markerLive}`)

  const echoBeforeUpdate = await probeEcho(session.page, runDir, 'echo-pre')
  log('sessions', `pre-update echo interactive: ${echoBeforeUpdate}`)

  const preDaemon = resolveScopedDaemon(userDataDir)
  preDaemon.pids.forEach((p) => created.daemonPids.add(p))
  log('daemon', `pre-update daemon pid=${preDaemon.pid} appVersion=${preDaemon.appVersion}`)

  const preScrollback = await readTerminalTextBestEffort(session.page)

  // Close app normally; the detached daemon must remain alive.
  await closeApp(session.app)
  const daemonAliveAfterClose = preDaemon.pid != null && isPidAlive(preDaemon.pid)
  log('daemon', `alive after app close: ${daemonAliveAfterClose}`)

  // --- Start the console-window watch through the whole update + soak ---
  const watchDuration = 120 + opts.soakSeconds
  const watch = startWatch({ baselinePath, outPath: watchOut, durationSec: watchDuration })
  log('watch', `started (duration ${watchDuration}s) -> ${watchOut}`)

  // --- Update: install N+1 ---
  const toInstaller = resolveInstaller({
    localPath: opts.to,
    releaseTag: opts.toRelease,
    assetPattern: opts.assetPattern
  })
  log('update', `installing ${toInstaller}`)
  const updated = silentInstall(toInstaller)
  log('update', `installed ${updated.exePath} (version ${updated.version})`)

  // --- Relaunch and gather post-update evidence ---
  session = await launchInstalledApp({ exePath: updated.exePath, userDataDir })
  await waitForTerminalReady(session.page)

  const evidence = await gatherEvidence({
    profile: opts.expect,
    page: session.page,
    runDir,
    heartbeatFile,
    preDaemon,
    userDataDir,
    preScrollback,
    echoBeforeUpdate
  })
  evidence.postDaemon?.pids?.forEach((p) => created.daemonPids.add(p))

  // --- Soak, then stop the watch and evaluate ---
  log('soak', `waiting ${opts.soakSeconds}s for delayed flashes`)
  await delay(opts.soakSeconds * 1000)
  const { events } = await watch.stop()
  log('watch', `recorded ${events.length} new-window events`)

  const ctx = {
    profile: opts.expect,
    canary,
    watchEvents: events,
    markerPid: created.markerPid,
    daemonLog: readDaemonLog(userDataDir),
    ...evidence
  }
  const assertions = buildAssertions(ctx)
  const passed = allPassed(assertions)
  console.log(renderTable(assertions))
  log('result', passed ? 'PASS' : 'FAIL')

  await teardown({
    app: session.app,
    created,
    userDataDir,
    keepInstall: opts.keepInstall,
    hadPreexistingInstall,
    runDir
  })
  return passed ? 0 : 1
}

async function gatherEvidence(args) {
  const { profile, page, runDir, heartbeatFile, preDaemon, userDataDir, preScrollback } = args
  const postDaemon = resolveScopedDaemon(userDataDir)

  if (profile === 'survival') {
    const heartbeatBefore = fileMtimeMs(heartbeatFile)
    const heartbeatAdvancedAfterUpdate = await heartbeatAdvancedSince(
      heartbeatFile,
      heartbeatBefore
    )
    const echoObserved = await probeEcho(page, runDir, 'echo-post')
    const ctrlCInterrupted = await probeCtrlCInterruptsMarker(page, runDir, heartbeatFile)
    return {
      preDaemonPid: preDaemon.pid,
      postDaemonPid: postDaemon.pid,
      postDaemonAlive: postDaemon.pid != null && isPidAlive(postDaemon.pid),
      postDaemon,
      markerAliveAfter: isMarkerAlive(runDir),
      heartbeatAdvancedAfterUpdate,
      echoObserved,
      ctrlCInterrupted
    }
  }

  // cold-restore
  const postScrollback = await readTerminalTextBestEffort(page)
  const scrollbackRestored = scrollbackFidelity(preScrollback, postScrollback)
  await createTerminalTab(page)
  const echoObserved = await probeEcho(page, runDir, 'echo-fresh')
  const ctrlCInterrupted = await probeCtrlCOnFreshLoop(page, runDir)
  return {
    preDaemonPid: preDaemon.pid,
    preDaemonAliveAfter: preDaemon.pid != null && isPidAlive(preDaemon.pid),
    postDaemonPid: postDaemon.pid,
    postDaemonAlive: postDaemon.pid != null && isPidAlive(postDaemon.pid),
    postDaemon,
    scrollbackRestored,
    echoObserved,
    ctrlCInterrupted
  }
}

/**
 * Resolve THIS run's daemon, scoped to its isolated userData dir so unrelated
 * daemons on the machine are ignored. Prefers the pid file (authoritative,
 * carries appVersion); cross-checks the live process scan.
 */
function resolveScopedDaemon(userDataDir) {
  const pidFiles = readDaemonPidFiles(userDataDir)
  const scan = findDaemonProcesses(userDataDir)
  const pids = new Set()
  for (const rec of pidFiles) {
    if (typeof rec.pid === 'number') {
      pids.add(rec.pid)
    }
  }
  for (const proc of scan) {
    if (typeof proc.pid === 'number') {
      pids.add(proc.pid)
    }
  }
  const primary = pidFiles.find((r) => typeof r.pid === 'number')
  return {
    pid: primary?.pid ?? scan[0]?.pid ?? null,
    appVersion: primary?.appVersion ?? null,
    startedAtMs: primary?.startedAtMs ?? null,
    pids: [...pids]
  }
}

function isMarkerAlive(runDir) {
  const pid = readIntFile(path.join(runDir, 'marker.pid'))
  return pid != null && isPidAlive(pid)
}

async function heartbeatAdvancedSince(heartbeatFile, sinceMs) {
  await delay(1500)
  return fileMtimeMs(heartbeatFile) > sinceMs
}

function scrollbackFidelity(before, after) {
  // WebGL renderer can leave both empty; report unknown (null) rather than a
  // false failure. When text is available, check a stable prefix survived.
  if (!before || !before.trim() || !after || !after.trim()) {
    return null
  }
  const marker = before
    .trim()
    .split('\n')
    .find((l) => l.trim().length > 3)
  if (!marker) {
    return null
  }
  return after.includes(marker.trim())
}

export function readDaemonLog(userDataDir) {
  // The daemon log (when present) is JSONL: { src, ts, pid, event, ...details }.
  // Only genuinely-bad records fail a run — matched by EVENT NAME, not by any
  // string containing "error". The daemon logs benign 'uncaught-exception-
  // suppressed' events with name:"Error" for native PTY errors it intentionally
  // swallows (src/main/daemon/daemon-entry.ts); those must never fail, and
  // 'client-hello-rejected' with reason expected-hello/protocol-mismatch is
  // normal version-skew during an update. Non-JSON lines fall back to a raw
  // FATAL match so an unstructured crash dump still counts.
  const logPath = path.join(userDataDir, 'logs', 'daemon.log')
  if (!existsSync(logPath)) {
    return null
  }
  const errorLines = []
  let suppressedCount = 0
  for (const raw of readFileSync(logPath, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line) {
      continue
    }
    let rec
    try {
      rec = JSON.parse(line)
    } catch {
      if (/\bFATAL\b/.test(line)) {
        errorLines.push(line)
      }
      continue
    }
    if (rec.event === 'uncaught-exception-suppressed') {
      suppressedCount += 1
    } else if (
      rec.event === 'uncaught-exception-fatal' ||
      (rec.event === 'client-hello-rejected' && rec.reason === 'invalid-token')
    ) {
      errorLines.push(line)
    }
  }
  return { path: logPath, errorLines, suppressedCount }
}

async function teardown({ app, created, userDataDir, keepInstall, hadPreexistingInstall, runDir }) {
  try {
    await closeApp(app)
  } catch {
    /* already closed */
  }
  // Kill ONLY processes this harness created: the marker and this run's daemon
  // (scoped to the isolated userData). Never touch pre-existing user processes.
  killPid(created.markerPid)
  for (const pid of resolveScopedDaemon(userDataDir).pids) {
    killPid(pid)
  }
  for (const pid of created.daemonPids) {
    killPid(pid)
  }

  if (keepInstall) {
    log('teardown', `--keep-install set; leaving install + ${runDir}`)
    return
  }
  // Only uninstall when the harness fully OWNS the install (no pre-existing
  // build). When it overwrote a developer's existing install, leave it in place
  // — uninstalling would remove a build we did not put there.
  if (hadPreexistingInstall) {
    console.log(
      '\n*** NOTE: an Orca install existed before this run. It was OVERWRITTEN and the\n' +
        '    --to version is now installed. Your prior build was NOT restored — reinstall\n' +
        '    your intended build if needed. Skipping uninstall. ***\n'
    )
  } else {
    const uninstalled = silentUninstall()
    log('teardown', `uninstalled: ${uninstalled}`)
  }
  rmSync(runDir, { recursive: true, force: true })
}

function killPid(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return
  }
  try {
    execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
  } catch {
    /* already dead */
  }
}

function readIntFile(filePath) {
  try {
    const n = Number(readFileSync(filePath, 'utf8').trim())
    return Number.isInteger(n) ? n : null
  } catch {
    return null
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Only run the orchestrator when invoked directly, so the module (and
// readDaemonLog) can be imported by tests without kicking off a real install.
if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  main()
    .then((code) => {
      process.exitCode = code
    })
    .catch((err) => {
      console.error('[win-update-e2e] FATAL:', err.stack || err.message)
      process.exitCode = 1
    })
}

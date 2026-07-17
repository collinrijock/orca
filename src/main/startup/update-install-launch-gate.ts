import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// Why: Squirrel.Mac installs by swapping the bundle AFTER the app exits, and
// Electron's fork aborts the whole install ("App Still Running Error") when
// another instance of the bundle shows up mid-install. A user who reopens
// Orca in the seconds between "windows closed" and "updated app relaunched"
// becomes that instance: the update is silently discarded and they come back
// on the old version. The quitting app drops a handoff marker; a same-version
// launch that finds the marker fresh while this bundle's ShipIt installer is
// still alive exits instead — ShipIt then finishes and relaunches the updated
// app itself, so the user's click still ends with Orca open.
export const UPDATE_INSTALL_HANDOFF_MARKER_FILE = 'update-install-handoff.json'
// Why: the handoff normally resolves in seconds; the ceiling only bounds how
// long a crashed install could keep gating launches. The live-ShipIt check is
// the real gate, so a stale marker never locks the app out.
export const UPDATE_INSTALL_HANDOFF_MAX_AGE_MS = 10 * 60 * 1000

const PROCESS_LIST_TIMEOUT_MS = 2_000
const PROCESS_LIST_MAX_BYTES = 16 * 1024 * 1024

export type UpdateInstallHandoffMarker = {
  appVersion: string
  createdAtMs: number
}

function markerPath(userDataPath: string): string {
  return path.join(userDataPath, UPDATE_INSTALL_HANDOFF_MARKER_FILE)
}

/** Written by the updater immediately before the native install handoff. */
export function writeUpdateInstallHandoffMarker(
  userDataPath: string,
  appVersion: string,
  now = Date.now()
): void {
  try {
    const marker: UpdateInstallHandoffMarker = { appVersion, createdAtMs: now }
    writeFileSync(markerPath(userDataPath), JSON.stringify(marker))
  } catch {
    // Why: the marker only powers the relaunch-race guard; failing to write
    // it must never block the install itself.
  }
}

export function clearUpdateInstallHandoffMarker(userDataPath: string): void {
  try {
    rmSync(markerPath(userDataPath), { force: true })
  } catch {
    /* Removal is best-effort; a stale marker self-expires. */
  }
}

function readUpdateInstallHandoffMarker(userDataPath: string): UpdateInstallHandoffMarker | null {
  try {
    if (!existsSync(markerPath(userDataPath))) {
      return null
    }
    const parsed = JSON.parse(readFileSync(markerPath(userDataPath), 'utf8'))
    if (typeof parsed?.appVersion !== 'string' || typeof parsed?.createdAtMs !== 'number') {
      return null
    }
    return { appVersion: parsed.appVersion, createdAtMs: parsed.createdAtMs }
  } catch {
    return null
  }
}

function readProcessCommandList(): string {
  return execFileSync('ps', ['-xo', 'command='], {
    encoding: 'utf8',
    timeout: PROCESS_LIST_TIMEOUT_MS,
    maxBuffer: PROCESS_LIST_MAX_BYTES
  })
}

/** True when this bundle's Squirrel ShipIt installer is still running. The
 * bundle root comes from the executable path, so only an installer working on
 * this exact install is considered. */
export function isBundleShipItRunning(executablePath: string, processCommandList: string): boolean {
  // /Applications/Orca.app/Contents/MacOS/Orca → /Applications/Orca.app
  const bundleRoot = path.resolve(executablePath, '..', '..', '..')
  const shipItPath = path.join(
    bundleRoot,
    'Contents',
    'Frameworks',
    'Squirrel.framework',
    'Resources',
    'ShipIt'
  )
  // Why: anchor on argv[0]. A shell or grep merely mentioning the ShipIt path
  // in its arguments must not read as a live installer.
  return processCommandList.split('\n').some((line) => line.trimStart().startsWith(shipItPath))
}

export type UpdateInstallLaunchGateDeps = {
  platform?: NodeJS.Platform
  executablePath?: string
  now?: number
  readProcessList?: () => string
}

/**
 * Decide whether this launch should exit to let an in-flight update install
 * finish. Sync by design — it must resolve before any startup side effects,
 * and the process-table read only happens on the rare fresh-marker path.
 * Fails open everywhere: an unreadable marker or process table means launch.
 */
export function shouldDeferLaunchForUpdateInstall(options: {
  isPackaged: boolean
  userDataPath: string
  appVersion: string
  deps?: UpdateInstallLaunchGateDeps
}): boolean {
  const platform = options.deps?.platform ?? process.platform
  if (platform !== 'darwin' || !options.isPackaged) {
    return false
  }
  const marker = readUpdateInstallHandoffMarker(options.userDataPath)
  if (!marker) {
    return false
  }
  // A different running version means the install already happened (or was
  // rolled elsewhere) — this launch is the post-update relaunch.
  if (marker.appVersion !== options.appVersion) {
    clearUpdateInstallHandoffMarker(options.userDataPath)
    return false
  }
  const now = options.deps?.now ?? Date.now()
  if (now - marker.createdAtMs > UPDATE_INSTALL_HANDOFF_MAX_AGE_MS) {
    clearUpdateInstallHandoffMarker(options.userDataPath)
    return false
  }
  let processList: string
  try {
    processList = (options.deps?.readProcessList ?? readProcessCommandList)()
  } catch {
    clearUpdateInstallHandoffMarker(options.userDataPath)
    return false
  }
  if (isBundleShipItRunning(options.deps?.executablePath ?? process.execPath, processList)) {
    return true
  }
  // Same version and no installer left: the install died (aborted/failed).
  // Clear the marker so this and future launches proceed normally.
  clearUpdateInstallHandoffMarker(options.userDataPath)
  return false
}

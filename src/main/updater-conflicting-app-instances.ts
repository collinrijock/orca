import { execFile } from 'node:child_process'

// Why: Squirrel.Mac's ShipIt waits for EVERY running instance of the target
// bundle (NSRunningApplication matched by bundle id + bundle URL) to exit
// before it installs, and aborts with "App Still Running Error" if one
// appears mid-install. A second packaged Orca — a manually opened copy or an
// agent/e2e rig launching /Applications/Orca.app with a temp profile, often
// windowless and invisible — silently stalls the update forever while the
// user sees "app quit but never relaunched, still on the old version".
// Detecting those instances before the install handoff turns that silent
// wedge into an actionable message.
const PROCESS_LIST_TIMEOUT_MS = 2_000
// Why: a busy dev machine's per-user process table can exceed execFile's 1MB
// default; truncation would silently drop a conflicting instance.
const PROCESS_LIST_MAX_BYTES = 16 * 1024 * 1024

export type ProcessListReader = () => Promise<string>

function readCurrentUserProcessList(): Promise<string> {
  return new Promise((resolve, reject) => {
    // Why: `-x` (without `-a`) scopes to the current user's processes, which
    // mirrors NSRunningApplication's login-session scope — another macOS
    // user's Orca does not block ShipIt and must not block the update here.
    // On macOS `comm` is the full executable path, so instances launched from
    // the same bundle match exactly whatever their argv or profile is.
    // Pin the system binary because Orca hydrates PATH from the user's shell.
    execFile(
      '/bin/ps',
      ['-xo', 'pid=,comm='],
      { encoding: 'utf8', timeout: PROCESS_LIST_TIMEOUT_MS, maxBuffer: PROCESS_LIST_MAX_BYTES },
      (error, stdout) => {
        if (error) {
          reject(error)
          return
        }
        resolve(stdout)
      }
    )
  })
}

/** Parse `ps -xo pid=,comm=` output into pids whose executable path equals
 * `executablePath`, excluding `currentPid`. Executable paths may contain
 * spaces, so only the leading pid column is positional. */
export function parseSameExecutablePids(
  psOutput: string,
  executablePath: string,
  currentPid: number
): number[] {
  const pids: number[] = []
  for (const line of psOutput.split('\n')) {
    const match = /^\s*(\d+)\s+(.+?)\s*$/.exec(line)
    if (!match) {
      continue
    }
    const pid = Number(match[1])
    if (pid !== currentPid && match[2] === executablePath) {
      pids.push(pid)
    }
  }
  return pids
}

export type ConflictingInstanceDeps = {
  platform?: NodeJS.Platform
  executablePath?: string
  currentPid?: number
  readProcessList?: ProcessListReader
}

/**
 * Pids of other running app instances launched from this same executable.
 *
 * macOS-only by design: this mirrors Squirrel.Mac's pre-install wait/abort
 * semantics. The Windows and Linux installers manage running instances
 * themselves. Fails open — an undetectable process table must never block an
 * update install.
 */
export async function findConflictingAppInstancePids(
  deps: ConflictingInstanceDeps = {}
): Promise<number[]> {
  if ((deps.platform ?? process.platform) !== 'darwin') {
    return []
  }
  try {
    const output = await (deps.readProcessList ?? readCurrentUserProcessList)()
    return parseSameExecutablePids(
      output,
      deps.executablePath ?? process.execPath,
      deps.currentPid ?? process.pid
    )
  } catch {
    return []
  }
}

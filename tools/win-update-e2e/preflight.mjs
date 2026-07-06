// Preflight safety checks and the baseline window snapshot.
//
// The harness installs, updates, and uninstalls a real app and kills processes
// it created. To avoid ever touching a user's live Orca, it REFUSES to run when
// a pre-existing Orca app process (not a daemon) is already running that it did
// not start. Existing installs and detached daemons are warned about, not
// treated as fatal (the update path is what exercises them).

import { assertWin32, isElevated } from './platform-guard.mjs'
import { runCommandSync } from './powershell-runner.mjs'
import { captureBaseline } from './window-watch.mjs'
import { locateInstalledExe } from './installer-steps.mjs'
import { findDaemonProcesses } from './daemon-processes.mjs'

/**
 * Find running Orca APP processes (main window process), excluding daemons.
 * The daemon runs as Orca.exe too but always carries the daemon-entry.js marker
 * on its command line, so excluding that marker isolates the actual app.
 */
export function findAppProcesses() {
  const command = [
    `$procs = @(Get-CimInstance Win32_Process -Filter "Name = 'Orca.exe'" -ErrorAction SilentlyContinue |`,
    `  Where-Object { -not ($_.CommandLine -match 'daemon-entry\\.js') })`,
    `$out = @($procs | ForEach-Object {`,
    `  [pscustomobject]@{ pid = $_.ProcessId; commandLine = $_.CommandLine } })`,
    `ConvertTo-Json -InputObject @{ processes = $out } -Depth 4 -Compress`
  ].join('\n')
  const { stdout } = runCommandSync(command)
  const trimmed = stdout.trim()
  if (!trimmed) {
    return []
  }
  try {
    const parsed = JSON.parse(trimmed)
    const arr = parsed.processes
    return Array.isArray(arr) ? arr : arr ? [arr] : []
  } catch {
    return []
  }
}

/**
 * Run preflight. Returns { baseline, warnings, existingInstall }. Throws if a
 * pre-existing Orca app is running (never kill a user's process) or if an Orca
 * install already exists and allowExistingInstall was not passed (the run would
 * overwrite a developer's real build). baselinePath receives the snapshot of
 * currently-visible top-level windows.
 */
export function preflight({ baselinePath, allowExistingInstall = false }) {
  assertWin32('preflight')
  const warnings = []

  if (isElevated()) {
    warnings.push(
      'Running elevated. A per-user oneClick install does not need elevation; ' +
        'an elevated run can install to an unexpected profile.'
    )
  }

  const appProcesses = findAppProcesses()
  if (appProcesses.length > 0) {
    const listing = appProcesses.map((p) => `  pid ${p.pid}: ${p.commandLine}`).join('\n')
    throw new Error(
      `Refusing to run: ${appProcesses.length} Orca app process(es) are already ` +
        `running that this harness did not start. Close them first (this harness ` +
        `never kills pre-existing user processes):\n${listing}`
    )
  }

  const existingInstall = locateInstalledExe()
  if (existingInstall && !allowExistingInstall) {
    throw new Error(
      `Refusing to run: an Orca install already exists at ${existingInstall}. ` +
        `This run would silently OVERWRITE it with the --from/--to versions and ` +
        `leave the --to version installed — destroying a real Orca install on a ` +
        `developer machine. Pass --allow-existing-install to proceed anyway ` +
        `(your prior build will NOT be restored), or uninstall Orca first. Clean ` +
        `machines (CI/VM) never hit this.`
    )
  }
  if (existingInstall) {
    warnings.push(
      `--allow-existing-install set: the existing install at ${existingInstall} will be ` +
        `overwritten and the --to version left installed; teardown will NOT uninstall it.`
    )
  }

  const existingDaemons = findDaemonProcesses()
  if (existingDaemons.length > 0) {
    warnings.push(
      `${existingDaemons.length} pre-existing daemon process(es) found on this machine ` +
        `(pids: ${existingDaemons.map((d) => d.pid).join(', ')}). The run uses an isolated ` +
        `userData dir, so its daemon is tracked by scope and will not collide.`
    )
  }

  const baseline = captureBaseline(baselinePath)
  return { baseline, warnings, existingInstall }
}

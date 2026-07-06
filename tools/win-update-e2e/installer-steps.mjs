// Silent NSIS install / update / uninstall and installed-app discovery.
//
// Orca ships a per-user oneClick NSIS installer (electron-builder defaults:
// oneClick=true, perMachine=false) named orca-windows-setup.exe. One-click
// silent mode is `<setup.exe> /S`; the app installs under
// %LOCALAPPDATA%\Programs\<dir> and the exe is Orca.exe. The install dir casing
// is not guaranteed (observed lowercase "orca" on a dev box), so the exe is
// located by search, never by a hard-coded path.

import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { assertWin32 } from './platform-guard.mjs'
import { runCommandSync } from './powershell-runner.mjs'

const PRODUCT_NAME = 'Orca'
const EXE_NAME = 'Orca.exe'

/** Programs root that per-user oneClick NSIS installs into. */
function programsRoot() {
  const localAppData =
    process.env.LOCALAPPDATA ?? path.join(process.env.USERPROFILE ?? '', 'AppData', 'Local')
  return path.join(localAppData, 'Programs')
}

/**
 * Resolve a base/update installer to a local .exe path, downloading from a
 * GitHub release tag when requested. Keeps gh usage to a single `release
 * download` call (AGENTS.md rate-limit guidance).
 */
export function resolveInstaller({ localPath, releaseTag, assetPattern }) {
  if (localPath) {
    if (!existsSync(localPath)) {
      throw new Error(`Installer not found: ${localPath}`)
    }
    return path.resolve(localPath)
  }
  if (!releaseTag) {
    throw new Error('resolveInstaller: neither localPath nor releaseTag provided')
  }
  const outDir = mkdtempSync(path.join(tmpdir(), 'orca-e2e-installer-'))
  const result = spawnSync(
    'gh',
    ['release', 'download', releaseTag, '--pattern', assetPattern, '--dir', outDir],
    { encoding: 'utf8' }
  )
  if (result.status !== 0) {
    throw new Error(
      `gh release download ${releaseTag} failed (exit ${result.status}): ${result.stderr || result.stdout}`
    )
  }
  const found = findSetupExe(outDir)
  if (!found) {
    throw new Error(`No installer matching "${assetPattern}" in downloaded release ${releaseTag}`)
  }
  return found
}

function findSetupExe(dir) {
  const { stdout } = runCommandSync(
    `Get-ChildItem -Path '${dir}' -Filter '*.exe' -Recurse -ErrorAction SilentlyContinue | ` +
      `Select-Object -First 1 -ExpandProperty FullName`
  )
  const line = stdout.trim().split('\n')[0]?.trim()
  return line && existsSync(line) ? line : null
}

/**
 * Run an NSIS installer in one-click silent mode and wait for the installed exe
 * to appear. Returns { exePath, version }. The installer process returns before
 * copying finishes, so completion is confirmed by polling for the exe.
 */
export function silentInstall(setupExe, { timeoutMs = 180_000 } = {}) {
  assertWin32('silentInstall')
  if (!existsSync(setupExe)) {
    throw new Error(`Installer not found: ${setupExe}`)
  }
  // /S is the NSIS silent switch; the electron-builder oneClick installer needs
  // no other flags for a per-user install.
  const proc = spawnSync(setupExe, ['/S'], { encoding: 'utf8' })
  if (proc.error) {
    throw new Error(`Failed to launch installer ${setupExe}: ${proc.error.message}`)
  }

  const exePath = waitForInstalledExe(timeoutMs)
  if (!exePath) {
    throw new Error(
      `Installed ${EXE_NAME} did not appear under ${programsRoot()} within ${timeoutMs}ms`
    )
  }
  return { exePath, version: getExeVersion(exePath) }
}

function waitForInstalledExe(timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const exe = locateInstalledExe()
    if (exe) {
      return exe
    }
    sleepSync(1000)
  }
  return null
}

/** Locate the installed Orca.exe under %LOCALAPPDATA%\Programs (case-tolerant). */
export function locateInstalledExe() {
  const root = programsRoot()
  if (!existsSync(root)) {
    return null
  }
  const { stdout } = runCommandSync(
    `Get-ChildItem -Path '${root}' -Directory -ErrorAction SilentlyContinue | ` +
      `ForEach-Object { Join-Path $_.FullName '${EXE_NAME}' } | ` +
      `Where-Object { Test-Path $_ } | Select-Object -First 1`
  )
  const line = stdout.trim().split('\n')[0]?.trim()
  return line && existsSync(line) ? line : null
}

/** Read the ProductVersion string from an exe's version resource. */
export function getExeVersion(exePath) {
  const { stdout } = runCommandSync(`(Get-Item '${exePath}').VersionInfo.ProductVersion`)
  return stdout.trim() || null
}

/**
 * Silently uninstall via the NSIS-generated uninstaller. Best-effort: returns
 * false if no uninstaller is found rather than throwing, so teardown never
 * masks the real assertion result.
 */
export function silentUninstall() {
  assertWin32('silentUninstall')
  const exe = locateInstalledExe()
  if (!exe) {
    return false
  }
  const installDir = path.dirname(exe)
  const uninstaller = path.join(installDir, `Uninstall ${PRODUCT_NAME}.exe`)
  if (!existsSync(uninstaller)) {
    return false
  }
  // NSIS uninstallers must be run from a copy (they relocate themselves); _?=
  // forces synchronous, in-place uninstall so we can assert completion.
  spawnSync(uninstaller, ['/S', `_?=${installDir}`], { encoding: 'utf8' })
  sleepSync(2000)
  return !existsSync(exe)
}

function sleepSync(ms) {
  // Blocking sleep via Atomics keeps install polling simple and synchronous.
  const sab = new Int32Array(new SharedArrayBuffer(4))
  Atomics.wait(sab, 0, 0, ms)
}

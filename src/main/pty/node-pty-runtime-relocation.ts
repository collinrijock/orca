import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { app } from 'electron'

/**
 * Relocates node-pty's Windows native runtime (conpty.node, conpty.dll,
 * OpenConsole.exe, winpty binaries) from the install directory to userData.
 *
 * Why: the NSIS update installer force-closes every process whose image path
 * is under the install directory before replacing files. conpty.dll spawns
 * OpenConsole.exe from beside itself, so while these binaries live in the
 * install dir every live terminal's console host is killed mid-update.
 * Loading them from userData (via the ORCA_NODE_PTY_NATIVE_DIR override
 * patched into node-pty's loader) takes them out of the installer's kill
 * zone, and the detached daemon inherits the env var so its PTYs are covered.
 */
export const NODE_PTY_NATIVE_DIR_ENV_VAR = 'ORCA_NODE_PTY_NATIVE_DIR'

const RELOCATION_COMPLETE_MARKER = '.relocation-complete'

export function resolveNodePtyNativeSourceDir(nodePtyPackageDir: string): string | null {
  // Packaged builds carry the rebuilt binding in build/Release; dev installs
  // (and the forced-relocation test path) load from prebuilds.
  const candidates = [
    join(nodePtyPackageDir, 'build', 'Release'),
    join(nodePtyPackageDir, 'prebuilds', `win32-${process.arch}`)
  ]
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'conpty.node'))) {
      return candidate
    }
  }
  return null
}

function copyRuntimeTree(sourceDir: string, destDir: string): void {
  mkdirSync(destDir, { recursive: true })
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = join(sourceDir, entry.name)
    const destPath = join(destDir, entry.name)
    if (entry.isDirectory()) {
      copyRuntimeTree(sourcePath, destPath)
    } else if (entry.isFile() && !/\.pdb$/i.test(entry.name)) {
      copyFileSync(sourcePath, destPath)
    }
  }
}

export function ensureRelocatedNodePtyNativeRuntime(options: {
  sourceDir: string
  destRoot: string
  version: string
}): string | null {
  const { sourceDir, destRoot, version } = options
  const destDir = join(destRoot, version)
  try {
    // Why: the marker is written only after a full copy, so a crash mid-copy
    // leaves no marker and the next launch redoes the copy from scratch.
    if (!existsSync(join(destDir, RELOCATION_COMPLETE_MARKER))) {
      rmSync(destDir, { recursive: true, force: true })
      copyRuntimeTree(sourceDir, destDir)
      writeFileSync(join(destDir, RELOCATION_COMPLETE_MARKER), '')
    }
    // Why: stale per-version dirs are deliberately NOT deleted here. A
    // surviving daemon adopted from a previous app version still loads
    // conpty.dll/OpenConsole.exe out of its own version dir; on Windows the
    // running .exe/.dll images open with FILE_SHARE_DELETE, so a rename+delete
    // would succeed and pull the runtime out from under that live daemon,
    // breaking its next conpty spawn (ERROR_PATH_NOT_FOUND). Leaving old dirs
    // in place is safe — they are small and only cleaned once it's provably
    // safe (see follow-up daemon-version plumbing).
    return destDir
  } catch {
    // Fail open: node-pty keeps loading from the install dir, which is the
    // pre-relocation behavior (sessions then don't survive updates).
    return null
  }
}

export function installRelocatedNodePtyNativeRuntime(): void {
  if (process.platform !== 'win32') {
    return
  }
  if (!app.isPackaged && process.env.ORCA_FORCE_CONPTY_RELOCATION !== '1') {
    return
  }
  // Note: a pre-set env var is deliberately NOT honored here. The update
  // relaunch chain (old app -> installer -> new app) inherits the previous
  // version's value, which would pin the new process to stale binaries and
  // skip copying the current version.
  let nodePtyPackageDir: string
  try {
    const requireFromHere = createRequire(import.meta.url)
    nodePtyPackageDir = dirname(requireFromHere.resolve('node-pty/package.json'))
  } catch {
    return
  }
  const sourceDir = resolveNodePtyNativeSourceDir(nodePtyPackageDir)
  if (!sourceDir) {
    return
  }
  const destDir = ensureRelocatedNodePtyNativeRuntime({
    sourceDir,
    destRoot: join(app.getPath('userData'), 'node-pty-runtime'),
    version: app.getVersion()
  })
  if (destDir) {
    process.env[NODE_PTY_NATIVE_DIR_ENV_VAR] = destDir
  }
}

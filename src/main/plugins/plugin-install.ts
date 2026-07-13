import { execFile } from 'node:child_process'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import {
  PLUGIN_MANIFEST_FILENAME,
  isQualifiedPluginKey
} from '../../shared/plugins/plugin-manifest'
import {
  isAllowedPluginGitUrl,
  removePluginLock
} from '../../shared/plugins/plugin-install-lockfile'
import { readPluginLockfile, writePluginLockfile } from './plugin-install-lockfile-store'
import { installStagedPluginTree, type PluginInstallResult } from './plugin-install-staging'

export type { PluginInstallResult } from './plugin-install-staging'

export {
  PLUGIN_LOCKFILE_MAX_BYTES,
  pluginLockfilePath,
  readPluginLockfile
} from './plugin-install-lockfile-store'

/**
 * Plugin installer, v0 sources: local path + git URL `#ref`. Git operations
 * shell out to SYSTEM git (execFile, argv arrays — never a shell string, and
 * never a vendored checkout: private repos must work with the user's
 * existing credential helpers and SSH remotes). No script execution during
 * install, ever — the installer copies files, nothing more.
 *
 * Installs land in immutable hash-addressed dirs behind an atomic pointer
 * swap; the previous version dir is kept for one-step rollback.
 */

const execFileAsync = promisify(execFile)
const GIT_TIMEOUT_MS = 120_000
const pluginMutationChains = new Map<string, Promise<void>>()

async function serializePluginMutation<T>(
  pluginsDir: string,
  operation: () => Promise<T>
): Promise<T> {
  const previous = pluginMutationChains.get(pluginsDir) ?? Promise.resolve()
  const run = previous.catch(() => undefined).then(operation)
  const settled = run.then(
    () => undefined,
    () => undefined
  )
  pluginMutationChains.set(pluginsDir, settled)
  try {
    return await run
  } finally {
    if (pluginMutationChains.get(pluginsDir) === settled) {
      pluginMutationChains.delete(pluginsDir)
    }
  }
}

export async function installPluginFromLocalPath(input: {
  pluginsDir: string
  sourcePath: string
  hostVersion: string
}): Promise<PluginInstallResult> {
  return serializePluginMutation(input.pluginsDir, async () => {
    if (!existsSync(join(input.sourcePath, PLUGIN_MANIFEST_FILENAME))) {
      return { ok: false, error: `no ${PLUGIN_MANIFEST_FILENAME} found in ${input.sourcePath}` }
    }
    return installStagedPluginTree({
      pluginsDir: input.pluginsDir,
      stagingDir: input.sourcePath,
      hostVersion: input.hostVersion,
      source: { kind: 'local-path', path: input.sourcePath },
      resolvedCommit: null
    })
  })
}

async function runGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    timeout: GIT_TIMEOUT_MS,
    windowsHide: true,
    env: {
      ...process.env,
      // Never block an install on an interactive credential/host prompt.
      GIT_TERMINAL_PROMPT: '0'
    }
  })
  return stdout.trim()
}

export async function installPluginFromGit(input: {
  pluginsDir: string
  url: string
  /** `#ref` suffix: branch, tag, or full commit SHA. Empty = default branch. */
  ref: string
  hostVersion: string
}): Promise<PluginInstallResult> {
  if (!isAllowedPluginGitUrl(input.url)) {
    return { ok: false, error: 'plugin Git URL must use HTTPS or SSH' }
  }
  return serializePluginMutation(input.pluginsDir, async () => {
    const stagingDir = await mkdtemp(join(tmpdir(), 'orca-plugin-install-'))
    try {
      const ref = input.ref.trim()
      if (/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(ref)) {
        // Exact commit: shallow-fetch just that object.
        await runGit(['init', '--quiet', stagingDir], tmpdir())
        await runGit(['remote', 'add', 'origin', input.url], stagingDir)
        await runGit(['fetch', '--quiet', '--depth', '1', 'origin', ref], stagingDir)
        await runGit(['checkout', '--quiet', 'FETCH_HEAD'], stagingDir)
      } else {
        const args = ['clone', '--quiet', '--depth', '1']
        if (ref.length > 0) {
          args.push('--branch', ref)
        }
        args.push('--', input.url, stagingDir)
        await runGit(args, tmpdir())
      }
      const resolvedCommit = await runGit(['rev-parse', 'HEAD'], stagingDir)
      return await installStagedPluginTree({
        pluginsDir: input.pluginsDir,
        stagingDir,
        hostVersion: input.hostVersion,
        source: { kind: 'git', url: input.url, ref },
        resolvedCommit
      })
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    } finally {
      await rm(stagingDir, { recursive: true, force: true })
    }
  })
}

/** Removes the install dir, the plugin's data dir, and the lock entry. */
export async function removeInstalledPlugin(input: {
  pluginsDir: string
  pluginsDataDir: string
  pluginKey: string
}): Promise<void> {
  await serializePluginMutation(input.pluginsDir, async () => {
    if (!isQualifiedPluginKey(input.pluginKey)) {
      throw new Error(`invalid qualified plugin key: ${input.pluginKey}`)
    }
    await removeResolvedPluginDirectory(input.pluginsDir, input.pluginKey)
    await removeResolvedPluginDirectory(input.pluginsDataDir, input.pluginKey)
    await writePluginLockfile(
      input.pluginsDir,
      removePluginLock(await readPluginLockfile(input.pluginsDir), input.pluginKey)
    )
  })
}

async function removeResolvedPluginDirectory(rootDir: string, pluginKey: string): Promise<void> {
  let rootReal: string
  let targetReal: string
  try {
    rootReal = await realpath(resolve(rootDir))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return
    }
    throw error
  }
  try {
    targetReal = await realpath(resolve(rootDir, pluginKey))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return
    }
    throw error
  }
  const fromRoot = relative(rootReal, targetReal)
  if (
    fromRoot.length === 0 ||
    isAbsolute(fromRoot) ||
    fromRoot === '..' ||
    fromRoot.startsWith(`..${sep}`)
  ) {
    throw new Error(`refusing to remove plugin path outside ${rootReal}`)
  }
  await rm(resolve(rootDir, pluginKey), { recursive: true, force: true })
}

import { execFile } from 'node:child_process'
import { cp, mkdir, readFile, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'

const require = createRequire(import.meta.url)
const execFileAsync = promisify(execFile)
const NODE_GYP_PATH = require.resolve('node-gyp/bin/node-gyp.js')
const NODE_ADDON_API_DIRECTORY = dirname(require.resolve('node-addon-api/package.json'))
const BUILD_TIMEOUT_MS = 10 * 60 * 1000
const COMMAND_TIMEOUT_MS = 60 * 1000
const MAX_COMMAND_OUTPUT_BYTES = 16 * 1024 * 1024

async function runCommand(command, args, options = {}) {
  // Why: native build tools can be noisy or hang; both cases must settle within explicit bounds.
  const result = await execFileAsync(command, args, {
    ...options,
    encoding: 'utf8',
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
    timeout: options.timeout ?? COMMAND_TIMEOUT_MS,
    windowsHide: true
  })
  if (result.stdout) {
    process.stdout.write(result.stdout)
  }
  if (result.stderr) {
    process.stderr.write(result.stderr)
  }
  return result
}

function sourceFilter(source) {
  const normalized = source.replaceAll('\\', '/')
  return !/(?:^|\/)build(?:\/|$)/.test(normalized) && !/(?:^|\/)prebuilds(?:\/|$)/.test(normalized)
}

async function assertPatchedSource(nodePtyDirectory) {
  const [unixTerminal, ptySource, windowsAgent] = await Promise.all([
    readFile(join(nodePtyDirectory, 'lib', 'unixTerminal.js'), 'utf8'),
    readFile(join(nodePtyDirectory, 'src', 'unix', 'pty.cc'), 'utf8'),
    readFile(join(nodePtyDirectory, 'lib', 'conpty_console_list_agent.js'), 'utf8')
  ])
  if (
    !unixTerminal.includes("if (!helperPath.includes('app.asar.unpacked'))") ||
    !ptySource.includes('pty_format_spawn_error') ||
    !windowsAgent.includes('consoleProcessList = [shellPid]')
  ) {
    throw new Error('node-pty source is missing Orca-required patch markers')
  }
}

async function assertBuiltArtifacts(buildDirectory, tuple) {
  const releaseDirectory = join(buildDirectory, 'build', 'Release')
  const ptyPath = join(releaseDirectory, 'pty.node')
  if (!(await stat(ptyPath)).isFile()) {
    throw new Error('node-pty did not produce build/Release/pty.node')
  }
  if (tuple.startsWith('darwin-')) {
    const helperPath = join(releaseDirectory, 'spawn-helper')
    const helper = await stat(helperPath)
    if (!helper.isFile() || (helper.mode & 0o111) === 0) {
      throw new Error('macOS node-pty did not produce executable build/Release/spawn-helper')
    }
  }
}

async function stripBuiltArtifacts(buildDirectory, tuple) {
  const releaseDirectory = join(buildDirectory, 'build', 'Release')
  const ptyPath = join(releaseDirectory, 'pty.node')
  if (tuple.startsWith('linux-')) {
    await runCommand('strip', ['--strip-unneeded', ptyPath], {
      windowsHide: true,
      env: process.env
    })
  } else if (tuple.startsWith('darwin-')) {
    await runCommand('strip', ['-S', ptyPath, join(releaseDirectory, 'spawn-helper')], {
      windowsHide: true,
      env: process.env
    })
  }
}

export async function buildPatchedSshRelayNodePty({
  projectRoot,
  nodePath,
  nodeRoot,
  nodeVersion,
  tuple,
  buildDirectory
}) {
  const sourceDirectory = resolve(projectRoot, 'node_modules', 'node-pty')
  await assertPatchedSource(sourceDirectory)
  await mkdir(buildDirectory)
  await cp(sourceDirectory, buildDirectory, {
    recursive: true,
    dereference: true,
    filter: sourceFilter
  })
  await mkdir(join(buildDirectory, 'node_modules'), { recursive: true })
  await cp(NODE_ADDON_API_DIRECTORY, join(buildDirectory, 'node_modules', 'node-addon-api'), {
    recursive: true,
    dereference: true
  })

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), BUILD_TIMEOUT_MS)
  try {
    await runCommand(nodePath, [NODE_GYP_PATH, 'rebuild', '--release', `--nodedir=${nodeRoot}`], {
      cwd: buildDirectory,
      signal: controller.signal,
      timeout: BUILD_TIMEOUT_MS,
      windowsHide: true,
      env: {
        ...process.env,
        PATH: `${dirname(nodePath)}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}`,
        npm_config_arch: tuple.includes('arm64') ? 'arm64' : 'x64',
        npm_config_build_from_source: 'true',
        npm_config_nodedir: nodeRoot,
        npm_config_target: nodeVersion
      }
    })
  } finally {
    clearTimeout(timeout)
  }
  await assertBuiltArtifacts(buildDirectory, tuple)
  await stripBuiltArtifacts(buildDirectory, tuple)

  // Why: loading with the bundled executable catches an accidental host-ABI build immediately.
  await runCommand(
    nodePath,
    [
      '-e',
      `const {loadNativeModule}=require(${JSON.stringify(join(buildDirectory, 'lib', 'utils.js'))});` +
        `const loaded=loadNativeModule('pty');` +
        `if(!loaded.dir.replace(/\\\\/g,'/').includes('build/Release/'))process.exit(2);`
    ],
    { cwd: buildDirectory, windowsHide: true, env: process.env }
  )
  return { buildDirectory, releaseDirectory: join(buildDirectory, 'build', 'Release') }
}

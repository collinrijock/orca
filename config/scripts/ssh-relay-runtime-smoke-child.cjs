'use strict'

const { appendFile, mkdtemp, realpath, rename, rm, unlink, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { createRequire } = require('node:module')

const runtimeRoot = process.argv[2]
if (!runtimeRoot) {
  throw new Error('runtime root argument is required')
}
const runtimeRequire = createRequire(join(runtimeRoot, 'relay.js'))
const nodePty = runtimeRequire('node-pty')
const watcher = runtimeRequire('@parcel/watcher')
const TIMEOUT_MS = 15_000

function deadline(label) {
  let timeout
  const promise = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} exceeded ${TIMEOUT_MS} ms`)), TIMEOUT_MS)
  })
  return { promise, cancel: () => clearTimeout(timeout) }
}

async function ptySmoke() {
  const windows = process.platform === 'win32'
  const executable = windows
    ? 'powershell.exe'
    : process.env.SHELL && process.env.SHELL.startsWith('/')
      ? process.env.SHELL
      : '/bin/sh'
  const arguments_ = windows
    ? [
        '-NoLogo',
        '-NoProfile',
        '-Command',
        "$ErrorActionPreference='Stop';" +
          '[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);' +
          "Write-Output 'ORCA_PTY_READY';" +
          '$line=[Console]::ReadLine();' +
          '$size=$Host.UI.RawUI.WindowSize;' +
          'Write-Output ("ORCA_PTY_SIZE:{0}x{1}" -f $size.Width,$size.Height);' +
          'Write-Output ("ORCA_PTY_INPUT:{0}" -f $line);' +
          'exit 23'
      ]
    : [
        '-c',
        'printf "ORCA_PTY_READY\\n"; IFS= read -r line; stty size; printf "ORCA_PTY_INPUT:%s\\n" "$line"; exit 23'
      ]
  const terminal = nodePty.spawn(executable, arguments_, {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: runtimeRoot,
    env: process.env,
    useConpty: windows,
    // Why: the relay uses the bundled ConPTY runtime to preserve terminal rendering behavior.
    useConptyDll: windows
  })
  let output = ''
  let wroteInput = false
  terminal.onData((data) => {
    output += data
    if (!wroteInput && output.includes('ORCA_PTY_READY')) {
      wroteInput = true
      terminal.resize(101, 37)
      terminal.write('bounded-marker\r')
    }
  })
  const exited = new Promise((resolve, reject) => {
    terminal.onExit(resolve)
    terminal.onData(() => {
      if (output.length > 1024 * 1024) {
        reject(new Error('PTY smoke output exceeded 1 MiB'))
      }
    })
  })
  const timer = deadline('PTY smoke')
  let result
  try {
    result = await Promise.race([exited, timer.promise])
  } finally {
    timer.cancel()
    if (!result) {
      terminal.kill()
    }
  }
  if (
    result.exitCode !== 23 ||
    !output.includes('ORCA_PTY_INPUT:bounded-marker') ||
    !output.includes(windows ? 'ORCA_PTY_SIZE:101x37' : '37 101')
  ) {
    throw new Error(`PTY smoke mismatch: exit=${result.exitCode} output=${JSON.stringify(output)}`)
  }
  const { loadNativeModule } = runtimeRequire('node-pty/lib/utils')
  const nativeNames = windows ? ['conpty', 'conpty_console_list'] : ['pty']
  const nativeDirectories = nativeNames.map((name) => loadNativeModule(name).dir)
  if (
    nativeDirectories.some(
      (directory) => !directory.replaceAll('\\', '/').includes('build/Release/')
    )
  ) {
    throw new Error(
      `node-pty did not load patched build/Release artifacts: ${nativeDirectories.join(', ')}`
    )
  }
  return {
    exitCode: result.exitCode,
    resizedRows: 37,
    resizedColumns: 101,
    nativeDirectory: nativeDirectories.join(', ')
  }
}

async function waitFor(events, predicate, label) {
  const timer = deadline(label)
  try {
    while (!predicate(events)) {
      await Promise.race([new Promise((resolve) => setTimeout(resolve, 25)), timer.promise])
    }
  } catch (error) {
    throw new Error(`${error.message}; observed=${JSON.stringify(events.slice(-20))}`)
  } finally {
    timer.cancel()
  }
}

async function watcherSmoke() {
  const createdDirectory = await mkdtemp(join(tmpdir(), 'orca-runtime-watcher-'))
  // Why: macOS FSEvents reports `/private/var` even when tmpdir returned the `/var` symlink.
  const directory = await realpath(createdDirectory)
  const first = join(directory, 'first.txt')
  const second = join(directory, 'renamed.txt')
  const events = []
  let subscription
  try {
    subscription = await watcher.subscribe(directory, (error, batch) => {
      if (error) {
        throw error
      }
      events.push(...batch.map((event) => ({ type: event.type, path: event.path })))
    })
    await writeFile(first, 'created')
    await waitFor(
      events,
      (seen) => seen.some((event) => event.type === 'create' && event.path === first),
      'watcher create'
    )
    await appendFile(first, '-modified')
    await waitFor(
      events,
      (seen) => seen.some((event) => event.type === 'update' && event.path === first),
      'watcher modify'
    )
    await rename(first, second)
    await waitFor(
      events,
      (seen) =>
        seen.some((event) => event.type === 'delete' && event.path === first) &&
        seen.some((event) => event.type === 'create' && event.path === second),
      'watcher rename'
    )
    await unlink(second)
    await waitFor(
      events,
      (seen) => seen.some((event) => event.type === 'delete' && event.path === second),
      'watcher delete'
    )
    return {
      events: events.map((event) => ({ type: event.type, name: event.path.split(/[\\/]/).at(-1) }))
    }
  } finally {
    await subscription?.unsubscribe()
    await rm(directory, { recursive: true, force: true })
  }
}

async function main() {
  const started = process.hrtime.bigint()
  const [pty, watched] = await Promise.all([ptySmoke(), watcherSmoke()])
  const durationMs = Number(process.hrtime.bigint() - started) / 1e6
  process.stdout.write(
    `${JSON.stringify({ nodeVersion: process.version, modulesAbi: process.versions.modules, pty, watcher: watched, durationMs, rssBytes: process.memoryUsage().rss })}\n`
  )
}

main().catch((error) => {
  process.stderr.write(`Bundled runtime smoke failed: ${error.stack ?? error.message}\n`)
  process.exitCode = 1
})

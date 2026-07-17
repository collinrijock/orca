import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const projectRoot = resolve(import.meta.dirname, '../..')
const sourceRoot = join(projectRoot, 'native', 'windows-ssh-no-input-launcher')
const buildScript = join(
  projectRoot,
  'config',
  'scripts',
  'build-windows-ssh-no-input-launcher.mjs'
)
const itWindows = process.platform === 'win32' ? it : it.skip
let fixtureRoot
let launcherPath
let childFixturePath
let handleProbePath

beforeAll(() => {
  if (process.platform !== 'win32') {
    return
  }
  fixtureRoot = mkdtempSync(join(tmpdir(), 'orca ssh no-input launcher '))
  launcherPath = join(fixtureRoot, 'orca-ssh-no-input.exe')
  childFixturePath = join(fixtureRoot, 'child-fixture.cjs')
  handleProbePath = join(fixtureRoot, 'windows-launcher-handle-probe.exe')
  writeFileSync(childFixturePath, childFixtureSource, 'utf8')
  const build = spawnSync(process.execPath, [buildScript, '--output', launcherPath], {
    cwd: projectRoot,
    encoding: 'utf8'
  })
  expect(build.status, `${build.stdout}\n${build.stderr}`).toBe(0)

  const compilerPath = findFrameworkCompiler(process.env)
  expect(compilerPath).not.toBeNull()
  const probeSource = join(
    projectRoot,
    'native',
    'windows-ssh-no-input-launcher-test',
    'WindowsLauncherHandleProbe.cs'
  )
  const probeBuild = spawnSync(
    compilerPath,
    [
      '/nologo',
      '/target:exe',
      '/platform:anycpu',
      '/optimize+',
      '/warnaserror+',
      `/out:${handleProbePath}`,
      probeSource
    ],
    { cwd: projectRoot, encoding: 'utf8' }
  )
  expect(probeBuild.status, `${probeBuild.stdout}\n${probeBuild.stderr}`).toBe(0)
}, 20_000)

afterAll(() => {
  if (fixtureRoot) {
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
})

describe('Windows SSH no-input launcher', () => {
  it('keeps the artifact source scoped to the reviewed Win32 boundary', () => {
    const processSource = readFileSync(join(sourceRoot, 'WindowsSshChildProcess.cs'), 'utf8')
    const pipeSource = readFileSync(join(sourceRoot, 'WindowsAnonymousPipeSet.cs'), 'utf8')

    expect(processSource).toContain('ProcThreadAttributeHandleList')
    expect(processSource).toContain('IntPtr.Size * 3')
    expect(processSource).toContain('CreateSuspended')
    expect(processSource).toContain('CreateNoWindow')
    expect(processSource).toContain('JobObjectLimitKillOnJobClose')
    expect(processSource).toContain('WaitForMultipleObjects')
    expect(processSource).toContain('if (processStarted && !assignedToJob)')
    expect(pipeSource).toContain('CloseHandleChecked(stdinWrite)')
    expect(pipeSource).toContain('PumpCompletionTimeoutMilliseconds')
    expect(pipeSource).toContain('pumpFailureSignal.Set()')
  })

  it.skipIf(process.platform === 'win32')(
    'fails closed when compilation is attempted away from Windows',
    () => {
      const result = spawnSync(process.execPath, [buildScript], {
        cwd: projectRoot,
        encoding: 'utf8'
      })

      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('requires a Windows host')
    }
  )

  itWindows('preserves exact arguments and provides child stdin EOF before execution', () => {
    const args = ['', 'space value', 'quote"value', 'trailing slash\\', 'line one\nline two', '雪']
    const result = runLauncher('arguments-and-stdin', args, {
      input: Buffer.from('this input must not reach the SSH child', 'utf8')
    })

    expect(result.status, result.stderr.toString('utf8')).toBe(0)
    expect(JSON.parse(result.stdout.toString('utf8'))).toEqual({ args, stdinBytes: 0 })
  })

  itWindows('preserves binary stdout and stderr and propagates the child exit code', () => {
    const binary = runLauncher('binary-output')
    expect(binary.status).toBe(0)
    expect(binary.stdout).toEqual(Buffer.from([0x00, 0xff, 0x10, 0x0a, 0x80]))
    expect(binary.stderr).toEqual(Buffer.from([0xfe, 0x00, 0x7f, 0x0d, 0x0a]))

    const exited = runLauncher('exit-code', ['37'])
    expect(exited.status).toBe(37)
  })

  itWindows('does not leak an unrelated inheritable parent handle into the child', () => {
    const result = spawnSync(handleProbePath, [launcherPath], {
      cwd: fixtureRoot,
      encoding: 'utf8',
      timeout: 15_000,
      windowsHide: true
    })

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('ORCA-NO-INHERITED-HANDLE-LEAK')
  })

  itWindows(
    'kills the child job and settles boundedly when the launcher is cancelled',
    { timeout: 15_000 },
    async () => {
      const startedAt = performance.now()
      const child = spawn(launcherPath, [process.execPath, childFixturePath, 'hold'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      })
      const childPid = await readFirstLine(child.stdout, 5_000)
      expect(Number.isInteger(childPid)).toBe(true)

      const closePromise = waitForClose(child, 5_000)
      expect(child.kill('SIGKILL')).toBe(true)
      await closePromise
      await waitForProcessExit(childPid, 5_000)
      expect(performance.now() - startedAt).toBeLessThan(10_000)
    }
  )
})

function runLauncher(mode, args = [], options = {}) {
  return spawnSync(launcherPath, [process.execPath, childFixturePath, mode, ...args], {
    cwd: fixtureRoot,
    encoding: null,
    timeout: 10_000,
    windowsHide: true,
    ...options
  })
}

function findFrameworkCompiler(env) {
  const windowsDirectory = env.WINDIR ?? env.SystemRoot
  if (!windowsDirectory) {
    return null
  }
  return (
    [
      join(windowsDirectory, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
      join(windowsDirectory, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe')
    ].find((candidate) => existsSync(candidate)) ?? null
  )
}

function readFirstLine(stream, timeoutMs) {
  return new Promise((resolveLine, reject) => {
    let output = ''
    const timeout = setTimeout(
      () => reject(new Error('Timed out waiting for child PID.')),
      timeoutMs
    )
    stream.on('data', (chunk) => {
      output += chunk.toString('utf8')
      const newline = output.indexOf('\n')
      if (newline >= 0) {
        clearTimeout(timeout)
        resolveLine(Number.parseInt(output.slice(0, newline), 10))
      }
    })
    stream.on('error', reject)
  })
}

function waitForClose(child, timeoutMs) {
  return new Promise((resolveClose, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Launcher cancellation did not settle.')),
      timeoutMs
    )
    child.once('close', () => {
      clearTimeout(timeout)
      resolveClose()
    })
    child.once('error', reject)
  })
}

async function waitForProcessExit(pid, timeoutMs) {
  const deadline = performance.now() + timeoutMs
  while (performance.now() < deadline) {
    try {
      process.kill(pid, 0)
    } catch {
      return
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 25))
  }
  throw new Error(`Launcher child ${pid} survived job-owned cancellation.`)
}

const childFixtureSource = String.raw`const mode = process.argv[2]
if (mode === 'arguments-and-stdin') {
  let stdinBytes = 0
  process.stdin.on('data', (chunk) => { stdinBytes += chunk.length })
  process.stdin.on('end', () => {
    process.stdout.write(JSON.stringify({ args: process.argv.slice(3), stdinBytes }))
  })
  process.stdin.resume()
} else if (mode === 'binary-output') {
  process.stdout.write(Buffer.from([0x00, 0xff, 0x10, 0x0a, 0x80]))
  process.stderr.write(Buffer.from([0xfe, 0x00, 0x7f, 0x0d, 0x0a]))
} else if (mode === 'exit-code') {
  process.exit(Number.parseInt(process.argv[3], 10))
} else if (mode === 'hold') {
  process.stdout.write(String(process.pid) + '\n')
  setInterval(() => {}, 1000)
} else {
  process.exit(99)
}
`

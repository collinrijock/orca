import { spawn } from 'node:child_process'
import { performance } from 'node:perf_hooks'

import { describe, expect, it } from 'vitest'

import type { SshTarget } from '../../shared/ssh-types'
import { buildSshArgs } from './system-ssh-args'
import { findSystemSsh } from './system-ssh-binary'

type DiagnosticMode = 'private-console-regular-output-verbose-timeout'

type DiagnosticResult = {
  mode: DiagnosticMode
  success: boolean
  timedOut: boolean
  sentinel: boolean
  stdoutEnded: boolean
  processExit: number | null | 'not-observed'
  channelClosed: boolean
  closeCode: number | null | 'not-observed'
  stderrBytes: number
  stderrTail: string
  elapsedMs: number
}

const host = process.env.ORCA_SSH_RELAY_LIVE_WINDOWS_SYSTEM_SSH_HOST
const user = process.env.ORCA_SSH_RELAY_LIVE_WINDOWS_SYSTEM_SSH_USER
const identityFile = process.env.ORCA_SSH_RELAY_LIVE_WINDOWS_SYSTEM_SSH_IDENTITY
const launcherPath = process.env.ORCA_SSH_WINDOWS_NO_INPUT_LAUNCHER
const port = Number.parseInt(process.env.ORCA_SSH_RELAY_LIVE_WINDOWS_SYSTEM_SSH_PORT ?? '', 10)
const hasLiveInput = Boolean(host && user && identityFile && launcherPath && Number.isInteger(port))

function createTarget(): SshTarget {
  return {
    id: 'live-windows-no-input-handle-diagnostic',
    label: 'live-windows-no-input-handle-diagnostic',
    host: host as string,
    port,
    username: user as string,
    identityFile: identityFile as string,
    identitiesOnly: true,
    systemSshConnectionReuse: true,
    source: 'manual'
  }
}

async function runDiagnostic(): Promise<DiagnosticResult> {
  const sshPath = findSystemSsh()
  if (!sshPath) {
    throw new Error('Native Windows OpenSSH client is unavailable')
  }
  const mode: DiagnosticMode = 'private-console-regular-output-verbose-timeout'
  const startedAt = performance.now()
  // Why: Win32-OpenSSH still hangs with proven console EOF plus piped output, so this diagnostic
  // isolates stdout/stderr as bounded regular files without changing production transport.
  const sshArgs = buildSshArgs(createTarget())
  const destinationSeparator = sshArgs.indexOf('--')
  if (destinationSeparator < 0) {
    throw new Error('Windows OpenSSH diagnostic arguments lost the destination separator')
  }
  sshArgs.splice(destinationSeparator, 0, '-vvv')
  const child = spawn(
    launcherPath as string,
    ['--diagnostic-timeout-ms', '6000', sshPath, ...sshArgs, 'echo ORCA-SYSTEM-SSH-OK'],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
  )

  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderrBytes = 0
    let stderrTail = ''
    let stdoutEnded = false
    let processExit: number | null | 'not-observed' = 'not-observed'
    let channelClosed = false
    let closeCode: number | null | 'not-observed' = 'not-observed'
    let timedOut = false
    let settled = false
    const finish = (): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      clearTimeout(killTimeout)
      const sentinel = stdout.includes('ORCA-SYSTEM-SSH-OK')
      resolve({
        mode,
        success:
          !timedOut &&
          sentinel &&
          stdoutEnded &&
          processExit === 0 &&
          channelClosed &&
          closeCode === 0,
        timedOut,
        sentinel,
        stdoutEnded,
        processExit,
        channelClosed,
        closeCode,
        stderrBytes,
        stderrTail,
        elapsedMs: performance.now() - startedAt
      })
    }
    const timeout = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, 8_000)
    const killTimeout = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
      child.stdout?.destroy()
      child.stderr?.destroy()
      child.unref()
      finish()
    }, 10_000)

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stdout?.on('end', () => {
      stdoutEnded = true
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length
      // Why: retain only the diagnostic tail needed to classify the stuck client phase.
      stderrTail = (stderrTail + chunk.toString('utf8')).slice(-16 * 1024)
    })
    child.on('exit', (code) => {
      processExit = code
    })
    child.on('close', (code) => {
      channelClosed = true
      closeCode = code
      finish()
    })
    child.on('error', (error) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      clearTimeout(killTimeout)
      reject(error)
    })
  })
}

describe.skipIf(!hasLiveInput)('Windows OpenSSH no-input child-handle diagnostic', () => {
  it(
    'captures the verbose client phase after a bounded private-console diagnostic timeout',
    { timeout: 15_000 },
    async () => {
      expect(process.platform).toBe('win32')
      const privateConsoleRegularOutputVerboseTimeout = await runDiagnostic()
      console.log(
        `ssh_windows_no_input_handle_diagnostic=${JSON.stringify({ privateConsoleRegularOutputVerboseTimeout })}`
      )

      expect(privateConsoleRegularOutputVerboseTimeout.success).toBe(true)
    }
  )
})

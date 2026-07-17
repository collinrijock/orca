import { spawn } from 'node:child_process'
import { performance } from 'node:perf_hooks'

import { describe, expect, it } from 'vitest'

import type { SshTarget } from '../../shared/ssh-types'
import { buildSshArgs } from './system-ssh-args'
import { findSystemSsh } from './system-ssh-binary'

type DiagnosticMode = 'inherited' | 'overlapped'

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
  elapsedMs: number
}

const host = process.env.ORCA_SSH_RELAY_LIVE_WINDOWS_SYSTEM_SSH_HOST
const user = process.env.ORCA_SSH_RELAY_LIVE_WINDOWS_SYSTEM_SSH_USER
const identityFile = process.env.ORCA_SSH_RELAY_LIVE_WINDOWS_SYSTEM_SSH_IDENTITY
const port = Number.parseInt(process.env.ORCA_SSH_RELAY_LIVE_WINDOWS_SYSTEM_SSH_PORT ?? '', 10)
const hasLiveInput = Boolean(host && user && identityFile && Number.isInteger(port))

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

async function runDiagnostic(mode: DiagnosticMode): Promise<DiagnosticResult> {
  const sshPath = findSystemSsh()
  if (!sshPath) {
    throw new Error('Native Windows OpenSSH client is unavailable')
  }
  const startedAt = performance.now()
  const child = spawn(
    sshPath,
    [...buildSshArgs(createTarget(), { noInput: true }), 'echo ORCA-SYSTEM-SSH-OK'],
    {
      // Why: qualify a console-independent overlapped pipe against the
      // upstream inherited-handle control before changing production.
      stdio:
        mode === 'overlapped'
          ? ['overlapped', 'overlapped', 'overlapped']
          : ['inherit', 'pipe', 'pipe'],
      windowsHide: true
    }
  )
  if (mode === 'overlapped') {
    child.stdin?.destroy()
  }

  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderrBytes = 0
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
      clearTimeout(timeout)
      clearTimeout(killTimeout)
      reject(error)
    })
  })
}

describe.skipIf(!hasLiveInput)('Windows OpenSSH no-input child-handle diagnostic', () => {
  it(
    'compares inherited stdin with a console-independent overlapped EOF pipe',
    { timeout: 30_000 },
    async () => {
      expect(process.platform).toBe('win32')
      const inherited = await runDiagnostic('inherited')
      const overlapped = await runDiagnostic('overlapped')
      console.log(
        `ssh_windows_no_input_handle_diagnostic=${JSON.stringify({ inherited, overlapped })}`
      )

      // The inherited control must settle or this fixture cannot distinguish handle strategies.
      expect(inherited.success).toBe(true)
    }
  )
})

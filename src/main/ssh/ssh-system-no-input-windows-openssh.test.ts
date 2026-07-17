import { spawn } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

import { describe, expect, it } from 'vitest'

import type { SshTarget } from '../../shared/ssh-types'
import { buildSshArgs } from './system-ssh-args'
import { findSystemSsh } from './system-ssh-binary'

type DiagnosticMode = 'regular-file-eof-no-n'

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
  stdinFixtureRemoved: boolean
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

async function runDiagnostic(): Promise<DiagnosticResult> {
  const sshPath = findSystemSsh()
  if (!sshPath) {
    throw new Error('Native Windows OpenSSH client is unavailable')
  }
  const mode: DiagnosticMode = 'regular-file-eof-no-n'
  const startedAt = performance.now()
  const stdinDirectory = mkdtempSync(join(tmpdir(), 'orca-ssh-empty-stdin-'))
  const stdinPath = join(stdinDirectory, 'stdin')
  const stdinFd = openSync(stdinPath, 'wx+')
  let child: ReturnType<typeof spawn>
  try {
    child = spawn(sshPath, [...buildSshArgs(createTarget()), 'echo ORCA-SYSTEM-SSH-OK'], {
      // Why: a zero-length regular file is at EOF before CreateProcess without
      // triggering Win32-OpenSSH's NUL-handle bug.
      stdio: [stdinFd, 'pipe', 'pipe'],
      windowsHide: true
    })
  } catch (error) {
    closeSync(stdinFd)
    rmSync(stdinDirectory, { recursive: true, force: true })
    throw error
  }
  closeSync(stdinFd)

  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderrBytes = 0
    let stdoutEnded = false
    let processExit: number | null | 'not-observed' = 'not-observed'
    let channelClosed = false
    let closeCode: number | null | 'not-observed' = 'not-observed'
    let timedOut = false
    let settled = false
    const removeStdinFixture = (): boolean => {
      try {
        rmSync(stdinDirectory, { recursive: true, force: true })
        return true
      } catch {
        return false
      }
    }
    const finish = (): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      clearTimeout(killTimeout)
      const stdinFixtureRemoved = removeStdinFixture()
      const sentinel = stdout.includes('ORCA-SYSTEM-SSH-OK')
      resolve({
        mode,
        success:
          !timedOut &&
          sentinel &&
          stdoutEnded &&
          processExit === 0 &&
          channelClosed &&
          closeCode === 0 &&
          stdinFixtureRemoved,
        timedOut,
        sentinel,
        stdoutEnded,
        processExit,
        channelClosed,
        closeCode,
        stderrBytes,
        stdinFixtureRemoved,
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
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      clearTimeout(killTimeout)
      removeStdinFixture()
      reject(error)
    })
  })
}

describe.skipIf(!hasLiveInput)('Windows OpenSSH no-input child-handle diagnostic', () => {
  it(
    'qualifies regular-file stdin EOF without the Windows null-input option',
    { timeout: 15_000 },
    async () => {
      expect(process.platform).toBe('win32')
      const regularFileEofNoN = await runDiagnostic()
      console.log(`ssh_windows_no_input_handle_diagnostic=${JSON.stringify({ regularFileEofNoN })}`)

      expect(regularFileEofNoN.success).toBe(true)
    }
  )
})

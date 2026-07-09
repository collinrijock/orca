// Launch/install plumbing for the guest-resident WSL agent-hook relay:
// bundle resolution on the Windows side, the guest launch/install scripts,
// and the sentinel wait that turns a wsl.exe child's stdio into a
// MultiplexerTransport. Kept separate from the manager so the state machine
// stays readable. See docs/agent-status-over-wsl.md (STA-1515).
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

import { RELAY_SENTINEL, RELAY_SENTINEL_TIMEOUT_MS } from '../ssh/relay-protocol'
import type { MultiplexerTransport } from '../ssh/ssh-channel-multiplexer'
import {
  WSL_HOOK_RELAY_BUNDLE_NAME,
  WSL_HOOK_RELAY_DIR,
  WSL_HOOK_RELAY_NO_NODE_EXIT_CODE,
  WSL_HOOK_RELAY_VERSION_ENV,
  WSL_HOOK_RELAY_VERSION_FILE
} from '../../shared/wsl-hook-relay-contract'

const MAX_STARTUP_BUFFER_BYTES = 64 * 1024

export type WslHookRelayBundle = { jsPath: string; version: string }

export function resolveWslHookRelayBundle(): WslHookRelayBundle | null {
  // Mirrors getLocalRelayCandidates in ssh-relay-deploy: env override for
  // tests/dev, then packaged extraResources, then dev out/ paths.
  const candidates: string[] = []
  if (process.env.ORCA_RELAY_PATH) {
    candidates.push(join(process.env.ORCA_RELAY_PATH, 'wsl'))
  }
  if (process.resourcesPath) {
    candidates.push(join(process.resourcesPath, 'relay', 'wsl'))
    candidates.push(join(process.resourcesPath, 'app.asar.unpacked', 'out', 'relay', 'wsl'))
  }
  try {
    const appPath = app.getAppPath()
    candidates.push(join(appPath, 'resources', 'relay', 'wsl'))
    candidates.push(join(appPath, 'out', 'relay', 'wsl'))
  } catch {
    // app not ready in some test contexts — env/resources candidates suffice.
  }
  for (const dir of candidates) {
    const jsPath = join(dir, WSL_HOOK_RELAY_BUNDLE_NAME)
    const versionPath = join(dir, WSL_HOOK_RELAY_VERSION_FILE)
    if (existsSync(jsPath) && existsSync(versionPath)) {
      const version = readFileSync(versionPath, 'utf8').trim()
      if (version.length > 0) {
        return { jsPath, version }
      }
    }
  }
  return null
}

const GUEST_RELAY_DIR = `$HOME/${WSL_HOOK_RELAY_DIR}`

/** Guest launcher, installed alongside the bundle. Version check first so a
 *  stale install exits 42 and the host reinstalls; node resolution probes
 *  PATH then common install locations (nvm et al) because `sh -c` does not
 *  source interactive profiles. */
export function buildGuestLaunchScript(): string {
  return [
    '#!/bin/sh',
    `d="${GUEST_RELAY_DIR}"`,
    `v="$(cat "$d/${WSL_HOOK_RELAY_VERSION_FILE}" 2>/dev/null || true)"`,
    `[ -n "$${WSL_HOOK_RELAY_VERSION_ENV}" ] && [ "$v" = "$${WSL_HOOK_RELAY_VERSION_ENV}" ] || exit 42`,
    'n="$(command -v node 2>/dev/null || true)"',
    'if [ -z "$n" ]; then',
    '  for c in "$HOME/.nvm/versions/node"/*/bin/node /usr/local/bin/node /usr/bin/node "$HOME/.local/bin/node"; do',
    '    [ -x "$c" ] && n="$c"',
    '  done',
    'fi',
    `[ -n "$n" ] || exit ${WSL_HOOK_RELAY_NO_NODE_EXIT_CODE}`,
    `"$n" -e 'process.exit(Number(process.versions.node.split(".")[0])>=18?0:1)' 2>/dev/null || exit ${WSL_HOOK_RELAY_NO_NODE_EXIT_CODE}`,
    `exec "$n" "$d/${WSL_HOOK_RELAY_BUNDLE_NAME}"`,
    ''
  ].join('\n')
}

/** Idempotent install script, piped to `sh -s` over stdin. Heredocs with
 *  quoted delimiters carry the bundle (base64) and launcher verbatim, so no
 *  argv quoting crosses the wsl.exe boundary. */
export function buildGuestInstallScript(bundleJs: Buffer, version: string): string {
  const b64 = bundleJs.toString('base64').replace(/(.{1,120})/g, '$1\n')
  return [
    'set -e',
    'umask 077',
    `d="${GUEST_RELAY_DIR}"`,
    'mkdir -p "$d"',
    `base64 -d > "$d/bundle.tmp" << 'ORCA_EOF_BUNDLE'`,
    b64.trimEnd(),
    'ORCA_EOF_BUNDLE',
    `mv "$d/bundle.tmp" "$d/${WSL_HOOK_RELAY_BUNDLE_NAME}"`,
    `cat > "$d/launch.tmp" << 'ORCA_EOF_LAUNCH'`,
    buildGuestLaunchScript().trimEnd(),
    'ORCA_EOF_LAUNCH',
    'mv "$d/launch.tmp" "$d/launch.sh"',
    'chmod 700 "$d/launch.sh"',
    // Version marker last: a partial install stays "stale" and reinstalls.
    `printf '%s' '${version}' > "$d/${WSL_HOOK_RELAY_VERSION_FILE}"`,
    ''
  ].join('\n')
}

export function spawnWslRelayProcess(
  distro: string,
  env: NodeJS.ProcessEnv
): ChildProcessWithoutNullStreams {
  return spawn(
    'wsl.exe',
    ['-d', distro, '--', 'sh', '-c', 'exec sh "$HOME"/.orca-wsl/hook-relay/launch.sh'],
    { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
  )
}

export function runWslInstallProcess(
  distro: string,
  script: string,
  env: NodeJS.ProcessEnv
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('wsl.exe', ['-d', distro, '--', 'sh', '-s'], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    let stderr = ''
    child.stderr.on('data', (d: Buffer) => {
      stderr = (stderr + d.toString('utf8')).slice(-MAX_STARTUP_BUFFER_BYTES)
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stderr }))
    child.stdin.on('error', () => {
      // Guest exited before consuming stdin — surfaced via close/code.
    })
    child.stdin.write(script)
    child.stdin.end()
  })
}

export type WslRelayStartupFailure = {
  kind: 'exit' | 'timeout'
  code: number | null
  stderr: string
}

/** Wait for the relay's ready sentinel on the child's stdout, then hand the
 *  remaining stdio over as a MultiplexerTransport. WSL twin of the SSH
 *  deploy's waitForSentinel, over a ChildProcess instead of a ClientChannel. */
export function waitForWslRelaySentinel(
  child: ChildProcessWithoutNullStreams
): Promise<MultiplexerTransport> {
  return new Promise((resolve, reject) => {
    let settled = false
    let sentinelSeen = false
    let stdoutBuffer: Buffer = Buffer.alloc(0)
    let stderrOutput = ''
    let exitCode: number | null = null
    const sentinel = Buffer.from(RELAY_SENTINEL, 'utf8')
    const dataCallbacks: ((data: Buffer) => void)[] = []
    const closeCallbacks: (() => void)[] = []
    let closedNotified = false

    const fail = (failure: WslRelayStartupFailure): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      reject(Object.assign(new Error(formatStartupFailure(failure)), { startup: failure }))
    }

    const timeout = setTimeout(() => {
      child.kill()
      fail({ kind: 'timeout', code: null, stderr: stderrOutput })
    }, RELAY_SENTINEL_TIMEOUT_MS)

    const notifyClosed = (): void => {
      if (!closedNotified) {
        closedNotified = true
        for (const cb of closeCallbacks) {
          cb()
        }
      }
    }

    child.stderr.on('data', (d: Buffer) => {
      stderrOutput = (stderrOutput + d.toString('utf8')).slice(-MAX_STARTUP_BUFFER_BYTES)
    })
    child.on('error', (err) =>
      fail({ kind: 'exit', code: null, stderr: `${stderrOutput}\n${err.message}` })
    )
    child.on('exit', (code) => {
      exitCode = code
    })
    child.on('close', (code) => {
      if (sentinelSeen) {
        notifyClosed()
        return
      }
      fail({ kind: 'exit', code: code ?? exitCode, stderr: stderrOutput })
    })

    child.stdout.on('data', (chunk: Buffer) => {
      if (sentinelSeen) {
        for (const cb of dataCallbacks) {
          cb(chunk)
        }
        return
      }
      stdoutBuffer = Buffer.concat([stdoutBuffer, chunk])
      const idx = stdoutBuffer.indexOf(sentinel)
      if (idx === -1) {
        // Why: pre-sentinel stdout is untrusted startup noise; cap it so a
        // broken guest cannot grow memory until the timeout fires.
        if (stdoutBuffer.length > MAX_STARTUP_BUFFER_BYTES) {
          child.kill()
          fail({ kind: 'exit', code: null, stderr: 'startup output exceeded 64 KiB' })
        }
        return
      }
      sentinelSeen = true
      settled = true
      clearTimeout(timeout)
      const trailing = stdoutBuffer.subarray(idx + sentinel.length)
      const transport: MultiplexerTransport = {
        write: (data) => {
          try {
            child.stdin.write(data)
          } catch {
            // Channel already closing — mux close handling takes over.
          }
        },
        onData: (cb) => {
          dataCallbacks.push(cb)
          if (trailing.length > 0 && dataCallbacks.length === 1) {
            // Post-sentinel bytes that arrived in the same chunk.
            setImmediate(() => cb(trailing))
          }
        },
        onClose: (cb) => closeCallbacks.push(cb),
        close: () => child.kill()
      }
      resolve(transport)
    })
  })
}

function formatStartupFailure(failure: WslRelayStartupFailure): string {
  const detail = failure.stderr.trim()
  if (failure.kind === 'timeout') {
    return `WSL hook relay did not become ready within ${RELAY_SENTINEL_TIMEOUT_MS / 1000}s${detail ? `: ${detail}` : ''}`
  }
  return `WSL hook relay exited (code ${failure.code ?? 'unknown'})${detail ? `: ${detail}` : ''}`
}

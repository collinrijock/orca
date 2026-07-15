import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  CodexAppServerTimeoutError,
  CodexAppServerUnsupportedError,
  type CodexHookTrustGrantRequest,
  type CodexHookTrustGrantSessionResult
} from './codex-app-server-client'
import type { GrantEntryEnvelope } from './codex-app-server-grant-envelope'

// Why: hook install/refresh is synchronous launch prep — a Codex pane must
// not start before its trust is settled — but a stdio JSON-RPC session needs
// a live event loop. This bridge blocks the caller on spawnSync of a bundled
// ELECTRON_RUN_AS_NODE entry (same pattern as the daemon and parcel-watcher
// entries) that runs the session and reports one JSON envelope on stdout.

const GRANT_ENTRY_FILE_NAME = 'codex-app-server-grant-entry.js'
// Why: spawnSync must outlive the session deadline so the entry's own timeout
// (and its result envelope) win the race; the margin only reaps a hung entry.
const GRANT_ENTRY_TIMEOUT_MARGIN_MS = 5_000
const GRANT_ENTRY_MAX_BUFFER_BYTES = 16 * 1024 * 1024

export function resolveCodexGrantEntryPath(
  pathExists: (candidate: string) => boolean = existsSync
): string | null {
  // Why: this module is also bundled into a plain-Node CLI entry, so entry
  // discovery cannot import Electron. Replacing the module's own asar segment
  // finds the unpacked sibling in packaged builds and is a no-op in dev.
  const unpackedModuleDir = __dirname.replace('app.asar', 'app.asar.unpacked')
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  const candidates = [
    resourcesPath
      ? join(resourcesPath, 'app.asar.unpacked', 'out', 'main', 'codex', GRANT_ENTRY_FILE_NAME)
      : null,
    join(unpackedModuleDir, 'codex', GRANT_ENTRY_FILE_NAME),
    join(unpackedModuleDir, '..', 'codex', GRANT_ENTRY_FILE_NAME)
  ].filter((candidate): candidate is string => candidate !== null)
  for (const candidate of candidates) {
    if (pathExists(candidate)) {
      return candidate
    }
  }
  return null
}

export type RunGrantSessionSyncOptions = {
  entryPath?: string
  nodeCommand?: string
}

/**
 * Blocking wrapper for the grant session. Hook install/refresh is synchronous
 * launch prep (pane launch must not proceed until trust is settled), and a
 * stdio JSON-RPC session needs a live event loop — so the session runs in a
 * short-lived ELECTRON_RUN_AS_NODE child (same pattern as the daemon and
 * parcel-watcher entries) while the caller blocks on spawnSync. spawnSync
 * always reaps the entry; a killed entry closes the codex child's stdin,
 * which makes codex app-server exit on EOF.
 */
export function runCodexHookTrustGrantSessionSync(
  request: CodexHookTrustGrantRequest,
  options: RunGrantSessionSyncOptions = {}
): CodexHookTrustGrantSessionResult {
  const entryPath = options.entryPath ?? resolveCodexGrantEntryPath()
  if (!entryPath) {
    throw new Error('codex trust-grant entry bundle not found')
  }
  const spawned = spawnSync(options.nodeCommand ?? process.execPath, [entryPath], {
    input: JSON.stringify(request),
    encoding: 'utf8',
    timeout: request.invocation.timeoutMs + GRANT_ENTRY_TIMEOUT_MARGIN_MS,
    killSignal: 'SIGKILL',
    maxBuffer: GRANT_ENTRY_MAX_BUFFER_BYTES,
    windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  })
  if (spawned.error) {
    throw spawned.error
  }
  if (spawned.signal) {
    throw new CodexAppServerTimeoutError(
      `codex trust-grant entry killed by ${spawned.signal} after ${request.invocation.timeoutMs}ms deadline`
    )
  }
  const lines = (spawned.stdout ?? '').split('\n').filter((line) => line.trim().length > 0)
  const lastLine = lines.at(-1)
  let envelope: GrantEntryEnvelope | null = null
  if (lastLine) {
    try {
      envelope = JSON.parse(lastLine) as GrantEntryEnvelope
    } catch {
      envelope = null
    }
  }
  if (!envelope) {
    throw new Error(
      `codex trust-grant entry produced no result (exit ${spawned.status ?? 'unknown'})${
        spawned.stderr ? `: ${spawned.stderr.trim().slice(0, 400)}` : ''
      }`
    )
  }
  if (!envelope.ok) {
    if (envelope.unsupported) {
      throw new CodexAppServerUnsupportedError(envelope.message)
    }
    if (envelope.errorName === 'CodexAppServerTimeoutError') {
      throw new CodexAppServerTimeoutError(envelope.message)
    }
    throw new Error(envelope.message)
  }
  return envelope.result
}

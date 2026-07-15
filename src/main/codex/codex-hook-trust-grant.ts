import { resolveCodexCommand } from '../codex-cli/command'
import { getSpawnArgsForWindows } from '../win32-utils'
import { buildWslCodexAppServerArgs } from '../codex-accounts/wsl-codex-command'
import {
  isCodexAppServerUnsupportedError,
  type CodexHookTrustGrantRequest,
  type CodexHookTrustGrantSessionResult
} from './codex-app-server-client'
import { runCodexHookTrustGrantSessionSync } from './codex-app-server-grant-bridge'
import {
  codexAppServerCapabilityCache,
  getCodexAppServerHostKey
} from './codex-app-server-capability-cache'
import {
  binaryStampsMatch,
  buildNativeCodexBinaryStamp,
  readCodexTrustGrantLedgerHome,
  writeCodexTrustGrantLedgerHome,
  type CodexTrustGrantBinaryStamp,
  type CodexTrustGrantLedgerEntry
} from './codex-trust-grant-ledger'
import {
  computeTrustKey,
  normalizeHookTrustKeyForLookup,
  readHookTrustEntries,
  type CodexTrustEntry
} from './config-toml-trust'
import { getCodexHookTrustSignature } from './codex-hook-identity'
import { captureCodexTrustConfig, restoreCodexTrustConfig } from './codex-trust-config-rollback'

// Why: grants must never make launch prep slower than the codex TUI's own
// startup on the same host. Native sessions complete in ~100ms; WSL pays
// wsl.exe + login-shell + possible cold-distro costs, so it gets more room.
const NATIVE_GRANT_TIMEOUT_MS = 10_000
const WSL_GRANT_TIMEOUT_MS = 30_000
// Why: a transiently hung app-server must not block launch prep on every pane.
// The legacy lane remains available while a short, host-scoped cooldown runs.
export const CODEX_TRUST_GRANT_TRANSIENT_RETRY_INTERVAL_MS = 5 * 60_000

/** Ops escape hatch (not a setting): forces the unchanged fallback lane. */
const DISABLE_ENV_FLAG = 'ORCA_DISABLE_CODEX_TRUST_RPC'

export type CodexTrustGrantHost =
  | { kind: 'native' }
  | { kind: 'wsl'; distro: string; linuxRuntimeHome: string }

export type CodexManagedTrustGrantPlan = {
  /** Host-visible runtime home path (UNC for WSL) — ledger key + config reads. */
  runtimeHomePath: string
  /** Host-visible config.toml path holding the trust entries. */
  tomlPath: string
  /** Exact command string written to the managed hooks.json entries. */
  managedCommand: string
  /** Managed trust identities Orca just wrote (no trustedHash). */
  managedEntries: readonly CodexTrustEntry[]
  host: CodexTrustGrantHost
}

export type CodexTrustGrantFallbackReason =
  | 'disabled'
  | 'no-managed-entries'
  | 'unsupported'
  | 'unsupported-cached'
  | 'verify-failed'
  | 'retry-cached'
  | 'error'

export type CodexManagedTrustGrantOutcome =
  | { lane: 'rpc'; entries: CodexTrustEntry[] }
  | { lane: 'fallback'; reason: CodexTrustGrantFallbackReason }

export type CodexTrustGrantDiagnostics = {
  granted: number
  ledgerHits: number
  fellBack: number
  verifyFailed: number
  lastFallbackReason: CodexTrustGrantFallbackReason | null
}

const diagnostics: CodexTrustGrantDiagnostics = {
  granted: 0,
  ledgerHits: 0,
  fellBack: 0,
  verifyFailed: 0,
  lastFallbackReason: null
}
const transientRetryAfterByHost = new Map<string, number>()

export function getCodexTrustGrantDiagnostics(): CodexTrustGrantDiagnostics {
  return { ...diagnostics }
}

type CodexTrustGrantTelemetry = (event: {
  outcome: 'granted' | 'fallback' | 'verify_failed'
  hostKind: 'native' | 'wsl'
  reason?: CodexTrustGrantFallbackReason
}) => void

// Why: hook-service is bundled into plain-node CLI entries where electron
// (and therefore the telemetry client) cannot load; the Electron main process
// injects the tracker at startup instead of a static import.
let telemetry: CodexTrustGrantTelemetry = () => {}

export function setCodexTrustGrantTelemetry(tracker: CodexTrustGrantTelemetry): void {
  telemetry = tracker
}

type GrantSessionRunnerSync = (
  request: CodexHookTrustGrantRequest
) => CodexHookTrustGrantSessionResult

let runSessionSync: GrantSessionRunnerSync = runCodexHookTrustGrantSessionSync

function fallback(
  plan: CodexManagedTrustGrantPlan,
  reason: CodexTrustGrantFallbackReason,
  detail?: unknown
): CodexManagedTrustGrantOutcome {
  diagnostics.fellBack += 1
  diagnostics.lastFallbackReason = reason
  if (reason === 'verify-failed') {
    diagnostics.verifyFailed += 1
  }
  console.warn(
    `[codex-trust-grant] falling back to self-computed trust (reason=${reason}, host=${plan.host.kind})`,
    detail ?? ''
  )
  telemetry({
    outcome: reason === 'verify-failed' ? 'verify_failed' : 'fallback',
    hostKind: plan.host.kind,
    reason
  })
  return { lane: 'fallback', reason }
}

type ExpectedManagedEntry = {
  entry: CodexTrustEntry
  normalizedKey: string
  signature: string
}

function buildExpectedEntries(plan: CodexManagedTrustGrantPlan): ExpectedManagedEntry[] {
  return plan.managedEntries.map((entry) => ({
    entry,
    normalizedKey: normalizeHookTrustKeyForLookup(computeTrustKey(entry)),
    signature: getCodexHookTrustSignature(entry)
  }))
}

function resolveCurrentBinaryStamp(host: CodexTrustGrantHost): CodexTrustGrantBinaryStamp | null {
  if (host.kind === 'wsl') {
    return { kind: 'wsl', distro: host.distro }
  }
  const command = resolveCodexCommand()
  // Why: an unresolved bare command cannot be stat'ed; a null stamp still
  // allows ledger skips (config + signature checks gate them) and heals to a
  // real stamp on the next grant once the binary is resolvable.
  return command === 'codex' ? null : buildNativeCodexBinaryStamp(command)
}

function findLedgerGrant(
  plan: CodexManagedTrustGrantPlan,
  expected: ExpectedManagedEntry[],
  currentStamp: CodexTrustGrantBinaryStamp | null
): CodexTrustEntry[] | null {
  const home = readCodexTrustGrantLedgerHome(plan.runtimeHomePath)
  if (!home || !binaryStampsMatch(home.binary, currentStamp)) {
    return null
  }
  let trustStates: ReturnType<typeof readHookTrustEntries>
  try {
    trustStates = readHookTrustEntries(plan.tomlPath)
  } catch {
    return null
  }
  const entries: CodexTrustEntry[] = []
  for (const { entry, normalizedKey, signature } of expected) {
    const recorded = home.entries[normalizedKey]
    if (!recorded || recorded.signature !== signature) {
      return null
    }
    if (trustStates.get(normalizedKey)?.trustedHash !== recorded.trustedHash) {
      return null
    }
    entries.push({ ...entry, trustedHash: recorded.trustedHash })
  }
  return entries
}

function buildGrantRequest(
  plan: CodexManagedTrustGrantPlan,
  expected: ExpectedManagedEntry[]
): CodexHookTrustGrantRequest {
  if (plan.host.kind === 'wsl') {
    return {
      invocation: {
        command: 'wsl.exe',
        args: buildWslCodexAppServerArgs(plan.host.distro, plan.host.linuxRuntimeHome),
        timeoutMs: WSL_GRANT_TIMEOUT_MS
      },
      hooksListCwd: plan.host.linuxRuntimeHome,
      expectedTrustKeys: expected.map(({ normalizedKey }) => normalizedKey),
      managedCommand: plan.managedCommand
    }
  }
  const codexCommand = resolveCodexCommand()
  // Why: npm-installed codex on Windows is a .cmd shim that spawn cannot run
  // without cmd.exe /c; args-array + shell:true would hit DEP0190 instead.
  const { spawnCmd, spawnArgs } = getSpawnArgsForWindows(codexCommand, ['app-server'])
  return {
    invocation: {
      command: spawnCmd,
      args: spawnArgs,
      env: { CODEX_HOME: plan.runtimeHomePath },
      timeoutMs: NATIVE_GRANT_TIMEOUT_MS
    },
    hooksListCwd: plan.runtimeHomePath,
    expectedTrustKeys: expected.map(({ normalizedKey }) => normalizedKey),
    managedCommand: plan.managedCommand
  }
}

/**
 * Grants trust for Orca's managed Codex hooks through codex's own app-server
 * RPCs, verified by re-list. Returns the granted entries carrying Codex's
 * verbatim hashes, or a fallback marker — the caller then runs the previous
 * computeTrustedHash lane, byte-identical to the pre-RPC behavior. Never
 * throws: any unexpected failure is a fallback, because hook install is
 * best-effort launch prep.
 */
export function grantManagedCodexHookTrust(
  plan: CodexManagedTrustGrantPlan
): CodexManagedTrustGrantOutcome {
  try {
    if (process.env[DISABLE_ENV_FLAG] === '1') {
      return fallback(plan, 'disabled')
    }
    if (plan.managedEntries.length === 0) {
      return fallback(plan, 'no-managed-entries')
    }
    const expected = buildExpectedEntries(plan)
    const currentStamp = resolveCurrentBinaryStamp(plan.host)
    const ledgerEntries = findLedgerGrant(plan, expected, currentStamp)
    if (ledgerEntries !== null) {
      diagnostics.ledgerHits += 1
      return { lane: 'rpc', entries: ledgerEntries }
    }

    const hostKey = getCodexAppServerHostKey(plan.host)
    if (!codexAppServerCapabilityCache.shouldTry(hostKey)) {
      return fallback(plan, 'unsupported-cached')
    }
    const transientRetryAfter = transientRetryAfterByHost.get(hostKey)
    if (transientRetryAfter !== undefined) {
      if (Date.now() < transientRetryAfter) {
        return fallback(plan, 'retry-cached')
      }
      transientRetryAfterByHost.delete(hostKey)
    }

    const startedAtMs = Date.now()
    // Why: the RPC may rewrite config.toml before a later RPC fails. Restore
    // its exact pre-session bytes before the legacy lane runs so every fallback
    // has the same input and output as the pre-RPC implementation.
    const configSnapshot = captureCodexTrustConfig(plan.tomlPath)
    let result: CodexHookTrustGrantSessionResult
    try {
      result = runSessionSync(buildGrantRequest(plan, expected))
    } catch (error) {
      restoreCodexTrustConfig(plan.tomlPath, configSnapshot)
      if (isCodexAppServerUnsupportedError(error)) {
        transientRetryAfterByHost.delete(hostKey)
        codexAppServerCapabilityCache.rememberUnsupported(hostKey)
        return fallback(plan, 'unsupported', error)
      }
      transientRetryAfterByHost.set(
        hostKey,
        Date.now() + CODEX_TRUST_GRANT_TRANSIENT_RETRY_INTERVAL_MS
      )
      return fallback(plan, 'error', error)
    }
    // Why: the RPC surface answered, even if our entries were not verifiable —
    // remember support so a later drift event retries the preferred lane.
    codexAppServerCapabilityCache.rememberSupported(hostKey)
    if (result.outcome === 'verify-failed') {
      restoreCodexTrustConfig(plan.tomlPath, configSnapshot)
      transientRetryAfterByHost.set(
        hostKey,
        Date.now() + CODEX_TRUST_GRANT_TRANSIENT_RETRY_INTERVAL_MS
      )
      return fallback(plan, 'verify-failed', result.reason)
    }

    const byNormalizedKey = new Map(expected.map((item) => [item.normalizedKey, item]))
    const grantedEntries: CodexTrustEntry[] = []
    const ledgerRecord: Record<string, CodexTrustGrantLedgerEntry> = {}
    for (const granted of result.entries) {
      const match = byNormalizedKey.get(granted.normalizedKey)
      if (!match) {
        restoreCodexTrustConfig(plan.tomlPath, configSnapshot)
        transientRetryAfterByHost.set(
          hostKey,
          Date.now() + CODEX_TRUST_GRANT_TRANSIENT_RETRY_INTERVAL_MS
        )
        return fallback(plan, 'verify-failed', `unexpected granted key ${granted.key}`)
      }
      grantedEntries.push({ ...match.entry, trustedHash: granted.trustedHash })
      ledgerRecord[granted.normalizedKey] = {
        signature: match.signature,
        trustedHash: granted.trustedHash
      }
    }
    if (grantedEntries.length !== expected.length) {
      restoreCodexTrustConfig(plan.tomlPath, configSnapshot)
      transientRetryAfterByHost.set(
        hostKey,
        Date.now() + CODEX_TRUST_GRANT_TRANSIENT_RETRY_INTERVAL_MS
      )
      return fallback(plan, 'verify-failed', 'granted entry set did not cover expected entries')
    }
    transientRetryAfterByHost.delete(hostKey)
    try {
      writeCodexTrustGrantLedgerHome(plan.runtimeHomePath, {
        binary: currentStamp,
        entries: ledgerRecord
      })
    } catch (error) {
      // Why: a ledger write failure only costs an extra session next launch.
      console.warn('[codex-trust-grant] failed to persist grant ledger', error)
    }
    diagnostics.granted += 1
    console.log(
      `[codex-trust-grant] granted ${grantedEntries.length} managed hook entries via codex app-server ` +
        `(host=${plan.host.kind}, wrote=${result.wroteTrust}, ${Date.now() - startedAtMs}ms)`
    )
    telemetry({ outcome: 'granted', hostKind: plan.host.kind })
    return { lane: 'rpc', entries: grantedEntries }
  } catch (error) {
    return fallback(plan, 'error', error)
  }
}

export const _internals = {
  setGrantSessionRunnerSync(runner: GrantSessionRunnerSync | null): void {
    runSessionSync = runner ?? runCodexHookTrustGrantSessionSync
  },
  resetDiagnostics(): void {
    diagnostics.granted = 0
    diagnostics.ledgerHits = 0
    diagnostics.fellBack = 0
    diagnostics.verifyFailed = 0
    diagnostics.lastFallbackReason = null
    transientRetryAfterByHost.clear()
  }
}

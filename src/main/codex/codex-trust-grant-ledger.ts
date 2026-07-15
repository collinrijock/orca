import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { getOrcaManagedCodexHomePath } from './codex-home-paths'
import { normalizeCodexProjectPathForLookup } from './config-toml-trust'

// Why: a grant session blocks launch prep, so it must not run on every pane
// launch. This ledger records what a *verified* codex-side grant left behind
// (per runtime home): the hook identity that was granted, the Codex-computed
// hash, and the codex binary that computed it. Install skips the RPC while
// all three still hold; any drift (hook edit, config wipe, codex upgrade)
// re-triggers a grant before the pane launches.

export type CodexTrustGrantBinaryStamp =
  | { kind: 'native'; path: string; size: number; mtimeMs: number }
  // Why: there is no cheap way to stat the codex binary inside a WSL distro
  // from the host, so WSL grants revalidate only on hook/config drift. A WSL
  // codex upgrade that changes the hash algorithm re-grants on verify-fail of
  // the next launch's status rather than pre-emptively.
  | { kind: 'wsl'; distro: string }

export type CodexTrustGrantLedgerEntry = {
  /** getCodexHookTrustSignature() of the granted hook identity. */
  signature: string
  /** Codex-computed hash verified as trusted via hooks/list. */
  trustedHash: string
}

export type CodexTrustGrantLedgerHome = {
  binary: CodexTrustGrantBinaryStamp | null
  /** Keyed by normalizeHookTrustKeyForLookup(trust key). */
  entries: Record<string, CodexTrustGrantLedgerEntry>
}

type CodexTrustGrantLedgerFile = {
  version: 1
  homes: Record<string, CodexTrustGrantLedgerHome>
}

export function getCodexTrustGrantLedgerPath(): string {
  return join(dirname(getOrcaManagedCodexHomePath()), 'trust-grant-ledger.json')
}

export function getCodexTrustGrantHomeKey(runtimeHomePath: string): string {
  return normalizeCodexProjectPathForLookup(runtimeHomePath)
}

function readLedgerFile(ledgerPath: string): CodexTrustGrantLedgerFile {
  const empty: CodexTrustGrantLedgerFile = { version: 1, homes: {} }
  if (!existsSync(ledgerPath)) {
    return empty
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(ledgerPath, 'utf-8'))
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      (parsed as CodexTrustGrantLedgerFile).version !== 1
    ) {
      return empty
    }
    const homes = (parsed as CodexTrustGrantLedgerFile).homes
    if (!homes || typeof homes !== 'object' || Array.isArray(homes)) {
      return empty
    }
    return { version: 1, homes }
  } catch {
    // Why: a corrupt ledger only costs one extra grant session; never let it
    // block hook install.
    return empty
  }
}

export function readCodexTrustGrantLedgerHome(
  runtimeHomePath: string,
  ledgerPath = getCodexTrustGrantLedgerPath()
): CodexTrustGrantLedgerHome | null {
  const home = readLedgerFile(ledgerPath).homes[getCodexTrustGrantHomeKey(runtimeHomePath)]
  if (!home || typeof home !== 'object' || Array.isArray(home)) {
    return null
  }
  if (!home.entries || typeof home.entries !== 'object' || Array.isArray(home.entries)) {
    return null
  }
  return home
}

export function writeCodexTrustGrantLedgerHome(
  runtimeHomePath: string,
  home: CodexTrustGrantLedgerHome,
  ledgerPath = getCodexTrustGrantLedgerPath()
): void {
  const file = readLedgerFile(ledgerPath)
  file.homes[getCodexTrustGrantHomeKey(runtimeHomePath)] = home
  writeFileSync(ledgerPath, `${JSON.stringify(file, null, 2)}\n`, {
    encoding: 'utf-8',
    mode: 0o600
  })
}

export function removeCodexTrustGrantLedgerHome(
  runtimeHomePath: string,
  ledgerPath = getCodexTrustGrantLedgerPath()
): void {
  const file = readLedgerFile(ledgerPath)
  const homeKey = getCodexTrustGrantHomeKey(runtimeHomePath)
  if (!(homeKey in file.homes)) {
    return
  }
  delete file.homes[homeKey]
  writeFileSync(ledgerPath, `${JSON.stringify(file, null, 2)}\n`, {
    encoding: 'utf-8',
    mode: 0o600
  })
}

export function buildNativeCodexBinaryStamp(binaryPath: string): CodexTrustGrantBinaryStamp | null {
  try {
    const stat = statSync(binaryPath)
    return { kind: 'native', path: binaryPath, size: stat.size, mtimeMs: stat.mtimeMs }
  } catch {
    return null
  }
}

export function binaryStampsMatch(
  recorded: CodexTrustGrantBinaryStamp | null,
  current: CodexTrustGrantBinaryStamp | null
): boolean {
  if (recorded === null || current === null) {
    // Why: an unresolvable binary stamp must not wedge installs into
    // re-granting forever; the config/signature checks still gate the skip.
    return recorded === null && current === null
  }
  if (recorded.kind === 'wsl' || current.kind === 'wsl') {
    return recorded.kind === 'wsl' && current.kind === 'wsl' && recorded.distro === current.distro
  }
  return (
    recorded.path === current.path &&
    recorded.size === current.size &&
    recorded.mtimeMs === current.mtimeMs
  )
}

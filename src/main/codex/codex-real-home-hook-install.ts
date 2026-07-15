import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import {
  buildManagedCommandHook,
  createManagedCommandMatcher,
  hookDefinitionHasManagedCommand,
  MANAGED_HOOK_TIMEOUT_SECONDS,
  readHooksJson,
  removeManagedCommands,
  writeHooksJson,
  writeManagedScript,
  type HookDefinition,
  type HooksConfig
} from '../agent-hooks/installer-utils'
import { getSystemCodexHomePath } from './codex-home-paths'
import { getCodexManagedScriptFileName } from './codex-hook-identity'
import { grantManagedCodexHookTrust } from './codex-hook-trust-grant'
import { removeCodexTrustGrantLedgerHome } from './codex-trust-grant-ledger'
import { getCodexManagedHookInstallMaterial } from './hook-service'
import { computeTrustKey, removeHookTrustEntries, type CodexTrustEntry } from './config-toml-trust'

/**
 * Real-home Codex hook lane for the system-default selection (flag ON).
 *
 * - 'pending': no attempt yet this process; routing may optimistically use the
 *   real home (reads are hook-free and the install runs before pane spawns).
 * - 'installed': entry appended LAST in ~/.codex/hooks.json and trusted by
 *   codex itself through the app-server grant client.
 * - 'unavailable': the grant lane could not trust the entry (old binary,
 *   unsupported RPC, verify failure). The entry is rolled back and the host
 *   stays on the managed-home lane.
 * - 'removed': hooks are opted out; Orca entries are swept from the real home.
 */
export type RealHomeCodexHookLane = 'pending' | 'installed' | 'unavailable' | 'removed'

let currentLane: RealHomeCodexHookLane = 'pending'

export function getRealHomeCodexHookLane(): RealHomeCodexHookLane {
  return currentLane
}

/**
 * Routing gate consumed by CodexRuntimeHomeService: the real home is usable
 * whenever hooks are opted out (nothing to install) or the grant lane has not
 * proven incapable on this host.
 */
export function isRealHomeCodexHookLaneUsable(hooksEnabled: boolean): boolean {
  return !hooksEnabled || currentLane !== 'unavailable'
}

function getRealHomeHooksJsonPath(): string {
  return join(getSystemCodexHomePath(), 'hooks.json')
}

function getRealHomeConfigTomlPath(): string {
  return join(getSystemCodexHomePath(), 'config.toml')
}

/** Orca-side state dir; nothing extra is ever written into the user's ~/.codex. */
function getRealHomeHookStateDir(userDataPath: string): string {
  return join(userDataPath, 'codex-real-home-hooks')
}

/**
 * Ensures the real-home hook state matches the settings: installs and trusts
 * the Orca status hook when enabled, sweeps it when opted out. Idempotent and
 * synchronous (launch prep); repeat calls are cheap — an unchanged hooks.json
 * write no-ops and a valid grant ledger skips the RPC session entirely.
 * Never throws: any failure logs and leaves the host on the managed lane.
 */
export function ensureRealHomeCodexHookState(args: {
  hooksEnabled: boolean
  userDataPath: string
}): RealHomeCodexHookLane {
  try {
    currentLane = args.hooksEnabled
      ? installRealHomeCodexHook(args.userDataPath)
      : sweepRealHomeCodexHook()
  } catch (error) {
    console.warn('[codex-real-home-hooks] ensure failed; staying on managed lane:', error)
    currentLane = args.hooksEnabled ? 'unavailable' : currentLane
  }
  return currentLane
}

function installRealHomeCodexHook(userDataPath: string): RealHomeCodexHookLane {
  const material = getCodexManagedHookInstallMaterial()
  const hooksJsonPath = getRealHomeHooksJsonPath()
  const config = readHooksJson(hooksJsonPath)
  if (!config) {
    // Why: an unparseable user file must never be clobbered; without a hook
    // entry the managed lane keeps status working for this host.
    console.warn('[codex-real-home-hooks] could not parse', hooksJsonPath, '- managed lane kept')
    return 'unavailable'
  }

  // Why: the same script the managed lane maintains; deploying here too keeps
  // host-connect ordering independent of the managed installer loop.
  writeManagedScript(material.scriptPath, material.script)

  const isManagedCommand = createManagedCommandMatcher(getCodexManagedScriptFileName())
  const nextHooks: Record<string, HookDefinition[]> = { ...config.hooks }
  const managedEntries: CodexTrustEntry[] = []
  for (const eventName of material.events) {
    const current = Array.isArray(nextHooks[eventName]) ? nextHooks[eventName] : []
    const cleaned = removeManagedCommands(current, isManagedCommand)
    // Why: append LAST. Codex trust keys are positional
    // (source:event:group:handler); prepending would shift every user entry
    // and invalidate the user's own hook trust records.
    nextHooks[eventName] = [...cleaned, { hooks: [buildManagedCommandHook(material.command)] }]
    managedEntries.push({
      sourcePath: hooksJsonPath,
      eventLabel: material.eventLabel[eventName],
      groupIndex: cleaned.length,
      handlerIndex: 0,
      command: material.command,
      timeoutSec: MANAGED_HOOK_TIMEOUT_SECONDS
    })
  }
  // Why: sweep stale Orca entries out of events the managed lane no longer
  // subscribes to, mirroring the managed installer's upgrade behavior.
  for (const [eventName, definitions] of Object.entries(nextHooks)) {
    if ((material.events as readonly string[]).includes(eventName) || !Array.isArray(definitions)) {
      continue
    }
    const cleaned = removeManagedCommands(definitions, isManagedCommand)
    if (cleaned.length === 0) {
      delete nextHooks[eventName]
    } else {
      nextHooks[eventName] = cleaned
    }
  }

  const previousRaw = existsSync(hooksJsonPath) ? readFileSync(hooksJsonPath, 'utf-8') : null
  backupRealHomeHooksJsonOnce(userDataPath, hooksJsonPath, previousRaw)
  // Why: unknown top-level fields belong to the user (other managers'
  // metadata); unlike the managed-home writer, preserve them verbatim.
  writeHooksJson(hooksJsonPath, { ...config, hooks: nextHooks } as HooksConfig)

  const grant = grantManagedCodexHookTrust({
    runtimeHomePath: getSystemCodexHomePath(),
    tomlPath: getRealHomeConfigTomlPath(),
    managedCommand: material.command,
    managedEntries,
    host: { kind: 'native' }
  })
  if (grant.lane === 'rpc') {
    return 'installed'
  }

  // Why: never leave an untrusted Orca entry in the user's real home — it
  // would surface as "Hooks need review". Roll the file back to its prior
  // bytes and keep this host on the managed-home lane; the grant client
  // already logged the fallback reason.
  restoreRealHomeHooksJson(hooksJsonPath, previousRaw)
  console.warn(
    `[codex-real-home-hooks] trust grant unavailable (${grant.reason}); entry rolled back, managed lane kept`
  )
  return 'unavailable'
}

function sweepRealHomeCodexHook(): RealHomeCodexHookLane {
  const hooksJsonPath = getRealHomeHooksJsonPath()
  const config = readHooksJson(hooksJsonPath)
  if (!config?.hooks) {
    return 'removed'
  }
  const isManagedCommand = createManagedCommandMatcher(getCodexManagedScriptFileName())
  const material = getCodexManagedHookInstallMaterial()
  const nextHooks: Record<string, HookDefinition[]> = { ...config.hooks }
  const removedTrustKeys: string[] = []
  let removedAny = false
  for (const [eventName, definitions] of Object.entries(nextHooks)) {
    if (!Array.isArray(definitions)) {
      continue
    }
    definitions.forEach((definition, groupIndex) => {
      if (!hookDefinitionHasManagedCommand(definition, isManagedCommand)) {
        return
      }
      const eventLabel = material.eventLabel[eventName as (typeof material.events)[number]]
      if (!eventLabel) {
        return
      }
      removedTrustKeys.push(
        computeTrustKey({
          sourcePath: hooksJsonPath,
          eventLabel,
          groupIndex,
          handlerIndex: 0,
          command: material.command,
          timeoutSec: MANAGED_HOOK_TIMEOUT_SECONDS
        })
      )
    })
    const cleaned = removeManagedCommands(definitions, isManagedCommand)
    if (cleaned.length !== definitions.length) {
      removedAny = true
    }
    if (cleaned.length === 0) {
      delete nextHooks[eventName]
    } else {
      nextHooks[eventName] = cleaned
    }
  }
  if (removedAny) {
    writeHooksJson(hooksJsonPath, { ...config, hooks: nextHooks } as HooksConfig)
    // Why: dead [hooks.state] blocks for a removed hook are Orca-owned records;
    // dropping them keeps the user's config.toml from accumulating orphans.
    // Their removal never shifts user trust keys because Orca appends last.
    try {
      removeHookTrustEntries(getRealHomeConfigTomlPath(), removedTrustKeys)
    } catch (error) {
      console.warn('[codex-real-home-hooks] failed to drop Orca trust entries:', error)
    }
    try {
      removeCodexTrustGrantLedgerHome(getSystemCodexHomePath())
    } catch {
      // Ledger cleanup is bookkeeping only; the next grant rebuilds it.
    }
  }
  return 'removed'
}

/** One-time pristine copy of the user's file, kept under Orca's userData. */
function backupRealHomeHooksJsonOnce(
  userDataPath: string,
  hooksJsonPath: string,
  previousRaw: string | null
): void {
  if (previousRaw === null) {
    return
  }
  try {
    const backupDir = getRealHomeHookStateDir(userDataPath)
    const backupPath = join(backupDir, 'hooks.json.pre-orca')
    if (existsSync(backupPath)) {
      return
    }
    mkdirSync(backupDir, { recursive: true })
    copyFileSync(hooksJsonPath, backupPath)
  } catch (error) {
    console.warn('[codex-real-home-hooks] failed to write pristine backup:', error)
  }
}

function restoreRealHomeHooksJson(hooksJsonPath: string, previousRaw: string | null): void {
  try {
    if (previousRaw === null) {
      if (existsSync(hooksJsonPath)) {
        unlinkSync(hooksJsonPath)
      }
      return
    }
    const tmpPath = `${hooksJsonPath}.${process.pid}.rollback.tmp`
    writeFileSync(tmpPath, previousRaw, 'utf-8')
    renameSync(tmpPath, hooksJsonPath)
  } catch (error) {
    console.warn('[codex-real-home-hooks] failed to roll back hooks.json:', error)
  }
}

export const _internals = {
  setLaneForTesting(lane: RealHomeCodexHookLane): void {
    currentLane = lane
  }
}

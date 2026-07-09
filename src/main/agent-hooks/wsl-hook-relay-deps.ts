// DI seam for WslHookRelayManager: the full dependency contract plus the
// production wiring. Tests construct the manager with fakes for everything
// that spawns wsl.exe or touches the live agentHookServer.
import { readFileSync } from 'node:fs'

import { agentHookServer } from './server'
import { installRemoteManagedAgentHooks } from './remote-managed-hook-installers'
import {
  resolveWslHookRelayBundle,
  runWslInstallProcess,
  spawnWslRelayProcess,
  waitForWslRelaySentinel
} from './wsl-hook-relay-launch'
import { listWslDistrosAsync } from '../wsl'
import { isRemoteAgentHooksEnabled } from '../../shared/agent-hook-relay'

// Why: fresh WSL intermittently throws "Catastrophic failure (E_UNEXPECTED)"
// under concurrent wsl.exe spawn load; the retry pause is a dep so tests can
// collapse it.
export const WSL_RELAY_TRANSIENT_RETRY_DELAY_MS = 2_000

export type WslHookRelayManagerDeps = {
  platform: () => NodeJS.Platform
  remoteHooksEnabled: () => boolean
  hookCoordsEnv: () => Record<string, string>
  resolveBundle: typeof resolveWslHookRelayBundle
  readBundle: (jsPath: string) => Buffer
  listDistros: () => Promise<string[]>
  spawnRelay: typeof spawnWslRelayProcess
  runInstall: typeof runWslInstallProcess
  waitForSentinel: typeof waitForWslRelaySentinel
  ingest: (envelope: Record<string, unknown>, connectionId: string) => void
  installHooks: typeof installRemoteManagedAgentHooks
  warn: (message: string) => void
  transientRetryDelayMs: number
}

export const defaultWslHookRelayDeps: WslHookRelayManagerDeps = {
  platform: () => process.platform,
  remoteHooksEnabled: () => isRemoteAgentHooksEnabled(),
  hookCoordsEnv: () => agentHookServer.buildPtyEnv(),
  resolveBundle: resolveWslHookRelayBundle,
  readBundle: (jsPath) => readFileSync(jsPath),
  listDistros: () => listWslDistrosAsync(),
  spawnRelay: spawnWslRelayProcess,
  runInstall: runWslInstallProcess,
  waitForSentinel: waitForWslRelaySentinel,
  ingest: (envelope, connectionId) =>
    agentHookServer.ingestRemote(
      envelope as Parameters<typeof agentHookServer.ingestRemote>[0],
      connectionId
    ),
  installHooks: installRemoteManagedAgentHooks,
  warn: (message) => console.warn(message),
  transientRetryDelayMs: WSL_RELAY_TRANSIENT_RETRY_DELAY_MS
}

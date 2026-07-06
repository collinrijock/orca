import type { SFTPWrapper } from 'ssh2'
import type {
  AgentHookInstallSkipReason,
  AgentHookInstallStatus,
  AgentHookTarget
} from '../../shared/agent-hook-types'
import type { AgentCliPresenceResult } from '../../shared/managed-agent-hook-targets'
import { MANAGED_AGENT_HOOK_MANIFEST } from './managed-agent-hook-manifest'

export type RemoteManagedHookPresenceByAgent = Partial<
  Record<AgentHookTarget, AgentCliPresenceResult>
>

/** Agents whose managed hooks can install over SSH, derived from the manifest.
 *  Exported so the issue #7253 invariant test can assert every locally-managed
 *  service that implements `installRemote` stays wired for remote install. */
export const REMOTE_MANAGED_HOOK_INSTALLER_AGENTS: readonly AgentHookInstallStatus['agent'][] =
  MANAGED_AGENT_HOOK_MANIFEST.filter((entry) => Boolean(entry.installRemote)).map(
    (entry) => entry.target.agent
  )

function skippedStatus(
  agent: AgentHookTarget,
  remoteHome: string,
  skipReason: AgentHookInstallSkipReason,
  detail: string
): AgentHookInstallStatus {
  return {
    agent,
    state: 'skipped',
    configPath: remoteHome,
    managedHooksPresent: false,
    detail,
    skipReason
  }
}

export function hasRemoteManagedHookInstallCandidate(
  presenceByAgent: RemoteManagedHookPresenceByAgent
): boolean {
  return MANAGED_AGENT_HOOK_MANIFEST.some(
    (entry) =>
      Boolean(entry.installRemote) && presenceByAgent[entry.target.agent]?.state === 'found'
  )
}

export async function installRemoteManagedAgentHooks(
  sftp: SFTPWrapper,
  remoteHome: string,
  presenceByAgent: RemoteManagedHookPresenceByAgent
): Promise<AgentHookInstallStatus[]> {
  const results: AgentHookInstallStatus[] = []
  for (const entry of MANAGED_AGENT_HOOK_MANIFEST) {
    const agent = entry.target.agent
    if (!entry.installRemote) {
      results.push(
        skippedStatus(
          agent,
          remoteHome,
          'remote_hook_unsupported',
          'Remote managed hooks unsupported.'
        )
      )
      continue
    }
    const presence = presenceByAgent[agent]
    if (presence?.state !== 'found') {
      // Why: an omitted entry means the relay never reported a result, not
      // that the CLI was positively absent — only 'missing' is a real miss.
      const cliMissing = presence?.state === 'missing'
      results.push(
        skippedStatus(
          agent,
          remoteHome,
          cliMissing ? 'cli_not_found' : 'remote_presence_unavailable',
          cliMissing
            ? 'Remote CLI not found; managed hook install skipped.'
            : 'Remote CLI presence unavailable; managed hook install skipped.'
        )
      )
      continue
    }
    try {
      const result = await entry.installRemote(sftp, remoteHome)
      results.push(result)
      if (result.state === 'error') {
        console.warn(
          `[agent-hooks] Remote ${agent} managed hook install failed for ${result.configPath}: ${
            result.detail ?? 'unknown error'
          }`
        )
      }
    } catch (error) {
      // Why: remote hook installation must not block SSH workspace startup.
      // A broken agent config or transient SFTP failure should degrade status
      // reporting only, while terminals/filesystem/git still come online.
      const detail = error instanceof Error ? error.message : String(error)
      console.warn(`[agent-hooks] Remote ${agent} managed hook install threw: ${detail}`)
      results.push({
        agent,
        state: 'error',
        configPath: remoteHome,
        managedHooksPresent: false,
        detail
      })
    }
  }
  return results
}

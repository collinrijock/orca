import { YOLO_TUI_AGENT_ARGS } from '../../../../shared/tui-agent-permissions'
import type { AgentCompletionStatusSnapshot } from './agent-completion-coordinator-types'
import { useAppStore } from '@/store'

const CODEX_AUTO_APPROVED_PERMISSION_STATES = ['waiting', 'blocked'] as const
const CODEX_AUTO_APPROVED_ARGS = (YOLO_TUI_AGENT_ARGS.codex ?? '').trim()

function isCodexAutoApprovedPermissionState(
  state: AgentCompletionStatusSnapshot['state']
): state is (typeof CODEX_AUTO_APPROVED_PERMISSION_STATES)[number] {
  return state === 'waiting' || state === 'blocked'
}

export function isAutoApprovedCodexPermissionStatus(
  payload: AgentCompletionStatusSnapshot,
  paneKey: string
): boolean {
  if (payload.agentType !== 'codex' || !isCodexAutoApprovedPermissionState(payload.state)) {
    return false
  }

  const state = useAppStore.getState()
  const statusEntry = state.agentStatusByPaneKey[paneKey]
  if (!statusEntry) {
    return false
  }

  const launchConfig = state.getAgentLaunchConfigForStatusEntry(statusEntry)
  if (!launchConfig) {
    return false
  }

  return launchConfig.agentArgs.trim() === CODEX_AUTO_APPROVED_ARGS
}

export function createCodexAutoApprovalHookCompletionSuppressor(
  paneKey: string
): (payload: AgentCompletionStatusSnapshot) => boolean {
  return (payload) => isAutoApprovedCodexPermissionStatus(payload, paneKey)
}

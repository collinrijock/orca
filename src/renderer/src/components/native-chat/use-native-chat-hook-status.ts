import { useAppStore } from '../../store'
import type { AgentStatusState } from '../../../../shared/agent-status-types'

export function useNativeChatHookStatus(
  paneKey: string
): readonly [AgentStatusState | null, number | null, boolean] {
  // Why: primitive selectors keep unrelated pane/status updates from rerendering
  // native chat while still exposing the three fields used for reconciliation.
  const state = useAppStore((store) => store.agentStatusByPaneKey[paneKey]?.state ?? null)
  const stateStartedAt = useAppStore(
    (store) => store.agentStatusByPaneKey[paneKey]?.stateStartedAt ?? null
  )
  const hasWorkingSubagents = useAppStore(
    (store) =>
      store.agentStatusByPaneKey[paneKey]?.subagents?.some(
        (subagent) => subagent.state === 'working'
      ) ?? false
  )
  return [state, stateStartedAt, hasWorkingSubagents]
}

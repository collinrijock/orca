import {
  AGENT_STATUS_STALE_AFTER_MS,
  type AgentStatusEntry
} from '../../../../shared/agent-status-types'
import {
  isAskUserQuestionTool,
  isQuestionAnsweredSubmitInput,
  type AgentQuestionAnsweredInferenceRequest
} from '../../../../shared/agent-question-answered-intent'
import { isExplicitAgentStatusFresh } from '@/lib/agent-status'

export type AgentQuestionAnsweredInference = {
  observeSentTerminalInput(data: string): void
}

type AgentQuestionAnsweredInferenceDeps = {
  paneKey: string
  getStatusEntry: () => AgentStatusEntry | undefined
  inferQuestionAnswered: (
    request: AgentQuestionAnsweredInferenceRequest
  ) => boolean | Promise<boolean> | void
  now?: () => number
}

/** Sibling of the interrupt inference for a hook Claude never sends: answering
 *  an AskUserQuestion emits no event, so the submit keystroke into the waiting
 *  pane is the only "question dealt with" signal. Unlike interrupts there is
 *  no expected real hook to settle for, so the inference fires immediately —
 *  the main process re-validates the baseline, so a racing hook always wins. */
export function createAgentQuestionAnsweredInference({
  paneKey,
  getStatusEntry,
  inferQuestionAnswered,
  now = () => Date.now()
}: AgentQuestionAnsweredInferenceDeps): AgentQuestionAnsweredInference {
  return {
    observeSentTerminalInput(data) {
      if (!isQuestionAnsweredSubmitInput(data)) {
        return
      }
      const entry = getStatusEntry()
      if (
        !entry ||
        entry.state !== 'waiting' ||
        entry.agentType !== 'claude' ||
        !isAskUserQuestionTool(entry.toolName) ||
        !isExplicitAgentStatusFresh(entry, now(), AGENT_STATUS_STALE_AFTER_MS)
      ) {
        return
      }
      void inferQuestionAnswered({
        paneKey,
        baselineUpdatedAt: entry.updatedAt,
        baselineStateStartedAt: entry.stateStartedAt,
        baselinePrompt: entry.prompt,
        baselineAgentType: entry.agentType
      })
    }
  }
}

import { agentDeliversDraftViaNativePrefill } from '@/lib/agent-native-draft-prefill'
import { pasteDraftWhenAgentReady } from '@/lib/agent-paste-draft'
import {
  isPromptReceiptEligible,
  watchForPromptSubmitReceipt
} from '@/lib/agent-prompt-submit-receipt'
import { isNativeChatSupportedAgent } from '@/lib/native-chat-supported-agent'
import { useAppStore } from '@/store'
import type { TuiAgent } from '../../../shared/types'

/** Why a reason: launch failures diverge — 'readiness-timeout' means the TUI
 * never looked ready (nothing was sent), 'receipt-timeout' means the paste
 * and Enter went in but the agent never acknowledged a submitted prompt
 * (trust/update/login screen swallowed it — issue #7466). */
export type LaunchPromptDeliveryFailureReason = 'readiness-timeout' | 'receipt-timeout'

export async function deliverLaunchPromptToAgentTab(args: {
  tabId: string
  agent: TuiAgent
  content: string
  submit: boolean
  forcePaste: boolean
  timeoutMs?: number
  onTimeout?: (reason?: LaunchPromptDeliveryFailureReason) => void
}): Promise<boolean> {
  const { tabId, agent, content, submit, forcePaste, timeoutMs, onTimeout } = args
  const shouldSeed =
    submit === true && content.trim().length > 0 && isNativeChatSupportedAgent(agent)

  if (shouldSeed) {
    useAppStore.getState().seedNativeChatLaunchPrompt({
      tabId,
      agent,
      text: content,
      createdAt: Date.now()
    })
  }

  // Why: native-prefill agents (claude/openclaude etc.) get the prompt at launch,
  // so pasteDraftWhenAgentReady returns false without pasting. That is a successful
  // native delivery, not a failure — don't flag the seeded bubble in that case.
  const deliversViaNativePrefill = agentDeliversDraftViaNativePrefill(agent, forcePaste)

  // Why: readiness heuristics can pass on screens that swallow the paste
  // (codex trust/update, claude login), so submitted launch prompts are only
  // "delivered" once the agent's own managed hook acknowledges a submitted
  // prompt (UserPromptSubmit). Agents without installed managed hooks keep
  // the optimistic legacy verdict instead of false-failing.
  const requireReceipt = submit === true && (await isPromptReceiptEligible(agent))
  const receiptWatch = requireReceipt
    ? watchForPromptSubmitReceipt({ tabId, agent, since: Date.now() })
    : null

  const markSeedFailed = (): void => {
    if (shouldSeed) {
      useAppStore.getState().markNativeChatLaunchPromptFailed(tabId)
    }
  }

  const pasted = await pasteDraftWhenAgentReady({
    tabId,
    content,
    agent,
    submit,
    forcePaste,
    timeoutMs,
    onTimeout: onTimeout ? () => onTimeout('readiness-timeout') : undefined
  })

  if (!pasted && !deliversViaNativePrefill) {
    receiptWatch?.cancel()
    markSeedFailed()
    return false
  }

  if (receiptWatch) {
    const receipted = await receiptWatch.result
    if (!receipted) {
      onTimeout?.('receipt-timeout')
      markSeedFailed()
      return false
    }
  }

  return true
}

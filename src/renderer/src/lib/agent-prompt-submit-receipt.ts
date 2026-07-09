import type { AgentStatusIpcPayload } from '../../../shared/agent-status-types'
import type { TuiAgent } from '../../../shared/types'

// Why: hook receipts prove the agent accepted the prompt as a real turn —
// codex trust/update screens and claude login screens swallow pastes without
// ever firing UserPromptSubmit, and both agents' Orca-managed hooks emit it
// on genuine submission (issue #7466). Strict verification applies only to
// agents whose managed hook service is installed; anything else keeps the
// optimistic legacy behavior rather than false-failing on absent plumbing.
const RECEIPT_ELIGIBLE_AGENTS = new Set<TuiAgent>(['claude', 'codex'])

// Why: the receipt normally lands ~1-2s after submit, but a paste buffered
// during agent cold boot is only submitted once the TUI drains stdin — the
// window must absorb that boot, and a slow verdict is safe because failure
// only re-opens the recovery dialog.
export const PROMPT_RECEIPT_TIMEOUT_MS = 15_000

// Why: receivedAt is stamped by the main process while `since` is renderer
// time; a small slack absorbs cross-process clock skew without admitting
// receipts from a previous turn.
const RECEIPT_CLOCK_SLACK_MS = 2_000

export async function isPromptReceiptEligible(agent: TuiAgent | undefined): Promise<boolean> {
  if (!agent || !RECEIPT_ELIGIBLE_AGENTS.has(agent)) {
    return false
  }
  try {
    const status =
      agent === 'claude'
        ? await window.api.agentHooks.claudeStatus()
        : await window.api.agentHooks.codexStatus()
    return status.state === 'installed'
  } catch {
    return false
  }
}

export type PromptSubmitReceiptWatch = {
  /** Resolves true when a UserPromptSubmit receipt for the tab arrives; false on timeout/cancel. */
  result: Promise<boolean>
  cancel: () => void
}

/**
 * Watch the agent-status IPC stream for a UserPromptSubmit receipt bound to
 * `tabId`. Start the watch BEFORE submitting so a fast receipt cannot slip
 * past the subscription. Remote (SSH) launches arrive through the same
 * channel via the agent-hook relay, so no transport split is needed.
 */
export function watchForPromptSubmitReceipt(args: {
  tabId: string
  agent: TuiAgent
  since: number
  timeoutMs?: number
}): PromptSubmitReceiptWatch {
  const { tabId, agent, since, timeoutMs } = args
  let cancel: () => void = () => {}
  const result = new Promise<boolean>((resolve) => {
    let settled = false
    let unsubscribe: (() => void) | null = null
    let timer: number | null = null

    const finish = (value: boolean): void => {
      if (settled) {
        return
      }
      settled = true
      if (timer !== null) {
        window.clearTimeout(timer)
      }
      unsubscribe?.()
      resolve(value)
    }
    cancel = () => finish(false)

    unsubscribe = window.api.agentStatus.onSet((data: AgentStatusIpcPayload) => {
      if (data.tabId !== tabId) {
        return
      }
      if (data.hookEventName !== 'UserPromptSubmit' || data.hasExplicitPrompt !== true) {
        return
      }
      if (data.agentType !== undefined && data.agentType !== agent) {
        return
      }
      if (data.receivedAt < since - RECEIPT_CLOCK_SLACK_MS) {
        return
      }
      finish(true)
    })

    timer = window.setTimeout(() => finish(false), timeoutMs ?? PROMPT_RECEIPT_TIMEOUT_MS)
  })
  return { result, cancel }
}

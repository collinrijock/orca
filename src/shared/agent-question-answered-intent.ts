import type { AgentType } from './agent-status-types'

/** Baseline snapshot the renderer captured when it observed the submit
 *  keystroke. The main process re-validates every field against its own
 *  cached status so a racing real hook always wins over the inference. */
export type AgentQuestionAnsweredInferenceRequest = {
  paneKey: string
  baselineUpdatedAt: number
  baselineStateStartedAt: number
  baselinePrompt: string
  baselineAgentType: AgentType | undefined
}

/** True for the AskUserQuestion tool across the casing variants different
 *  agents emit (`AskUserQuestion` / `ask_user_question` / `askUserQuestion`).
 *  Why: this is the structured "pick an option" prompt whose full input the
 *  clients render as a live card. */
export function isAskUserQuestionTool(toolName: string | undefined): boolean {
  return toolName?.replaceAll(/[^a-z0-9]/gi, '').toLowerCase() === 'askuserquestion'
}

// Why: answering an interactive question emits no hook event, so the submit
// keystroke is the only signal that the question was dealt with. Enter (plus
// kitty-keyboard Enter encodings some agent TUIs enable) confirms the
// highlighted option, and a bare digit is the selector's quick-select, which
// submits immediately without Enter. Exact single-keystroke matches only —
// batched input or pasted text must never clear a pending question card.
const QUESTION_ANSWER_SUBMIT_INPUTS = new Set([
  '\r',
  '\n',
  '\r\n',
  '\x1b[13u',
  '\x1b[13;1u',
  ...'123456789'
])

export function isQuestionAnsweredSubmitInput(data: string): boolean {
  return QUESTION_ANSWER_SUBMIT_INPUTS.has(data)
}

import {
  TUI_AGENT_CONFIG,
  type AgentDraftInjectionStrategy
} from '../../../shared/tui-agent-config'
import type { TuiAgent } from '../../../shared/types'
import { waitForAgentReady } from '@/lib/agent-ready-wait'
import { useAppStore } from '@/store'

// Why: bracketed paste markers let modern TUIs (Claude Code / Codex / Gemini)
// treat the inserted text as a single atomic paste — they put it in their
// input buffer as a draft instead of echoing character-by-character or
// triggering line-edit shortcuts. Intentionally omit a trailing '\r' so the
// draft never auto-submits; the user gets to review and send themselves.
const BRACKETED_PASTE_BEGIN = '\x1b[200~'
const BRACKETED_PASTE_END = '\x1b[201~'

// Why: 'bracketed-paste' uses the existing Claude-tuned grace; 'slow' adds
// margin for TUIs that emit \x1b[?2004h instantly but only enable the input
// box after a splash/model-init phase (Codex). 'type-chars' bypasses paste
// markers entirely and types one character at a time with a small inter-key
// delay so the input handler can debounce/render between keys.
const SLOW_GRACE_MS = 1500
const CHAR_TYPING_DELAY_MS = 25

function resolveDraftStrategy(agent: TuiAgent | undefined): AgentDraftInjectionStrategy {
  if (!agent) {
    return 'bracketed-paste'
  }
  return TUI_AGENT_CONFIG[agent].draftInjectionStrategy ?? 'bracketed-paste'
}

/**
 * Wait for the agent on `tabId` to be ready, then deliver `content` into its
 * input buffer as a non-submitted draft. Strategy is per-agent (see
 * `TUI_AGENT_CONFIG[agent].draftInjectionStrategy`); falls back to bracketed
 * paste when the agent is not specified.
 *
 * Returns true when an injection was issued, false on timeout, missing PTY,
 * or `unsupported` strategy. `onTimeout` lets the caller surface a UI hint
 * (e.g. toast) when the agent doesn't reach a ready state inside `timeoutMs`.
 */
export async function pasteDraftWhenAgentReady(args: {
  tabId: string
  expectedProcess: string
  content: string
  agent?: TuiAgent
  timeoutMs?: number
  onTimeout?: () => void
}): Promise<boolean> {
  const { tabId, expectedProcess, content, agent, timeoutMs = 15000, onTimeout } = args
  const strategy = resolveDraftStrategy(agent)
  if (strategy === 'unsupported') {
    return false
  }

  const readyResult = await waitForAgentReady(tabId, expectedProcess, { timeoutMs })
  if (!readyResult.ready) {
    onTimeout?.()
    return false
  }

  const ptyId = useAppStore.getState().ptyIdsByTabId[tabId]?.[0]
  if (!ptyId) {
    return false
  }

  // Why: TUIs must enable bracketed paste mode (\x1b[?2004h) before they can
  // interpret our paste markers. `title-idle` means the TUI has fully rendered
  // its input box and enabled paste mode; weaker signals (`foreground-match`,
  // `child-process`) only confirm the binary is running — the TUI's input
  // setup may still be in-flight, especially on slow shell environments.
  const baseGraceMs = readyResult.reason === 'title-idle' ? 150 : 600
  const graceMs =
    strategy === 'bracketed-paste-slow' ? Math.max(baseGraceMs, SLOW_GRACE_MS) : baseGraceMs
  await new Promise((resolve) => window.setTimeout(resolve, graceMs))

  if (strategy === 'type-chars') {
    await typeChars(ptyId, content)
    return true
  }

  window.api.pty.write(ptyId, `${BRACKETED_PASTE_BEGIN}${content}${BRACKETED_PASTE_END}`)
  return true
}

async function typeChars(ptyId: string, content: string): Promise<void> {
  // Why: send characters individually with a small delay so the TUI's input
  // handler can render and debounce between keystrokes. URLs only contain
  // safe characters (no control codes, no tab/space/newline) so each char is
  // a literal keypress with no accidental command-trigger semantics.
  for (const char of content) {
    window.api.pty.write(ptyId, char)
    await new Promise((resolve) => window.setTimeout(resolve, CHAR_TYPING_DELAY_MS))
  }
}

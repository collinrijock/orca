import type {
  TerminalAgentQuickCommand,
  TerminalQuickCommand,
  TerminalQuickCommandAction,
  TerminalQuickCommandScope,
  TuiAgent
} from '../../../src/shared/types'
import {
  MOBILE_TUI_AGENT_LABELS,
  MOBILE_TUI_AGENT_LAUNCH_COMMANDS,
  mobileTuiAgentSupportsPromptCommand
} from '../tasks/mobile-tui-agents'

// Why: mobile mirrors the desktop terminal-quick-commands logic locally instead
// of runtime-importing src/shared (which pulls in tui-agent-config and breaks
// mobile Vitest transforms). Kept behaviourally identical; the server re-runs the
// canonical normalizeTerminalQuickCommands on write.

export const MAX_QUICK_COMMAND_LABEL_LENGTH = 80
export const MAX_QUICK_COMMAND_TERMINAL_TEXT_LENGTH = 4000
export const MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH = 6000

export function getQuickCommandAction(command: TerminalQuickCommand): TerminalQuickCommandAction {
  return command.action === 'agent-prompt' ? 'agent-prompt' : 'terminal-command'
}

export function isAgentQuickCommand(
  command: TerminalQuickCommand
): command is TerminalAgentQuickCommand {
  return getQuickCommandAction(command) === 'agent-prompt'
}

export function getQuickCommandScope(command: TerminalQuickCommand): TerminalQuickCommandScope {
  const scope = command.scope
  if (scope && scope.type === 'repo' && typeof scope.repoId === 'string' && scope.repoId.trim()) {
    return { type: 'repo', repoId: scope.repoId }
  }
  return { type: 'global' }
}

export function quickCommandMatchesRepo(
  command: TerminalQuickCommand,
  repoId: string | null
): boolean {
  const scope = getQuickCommandScope(command)
  return scope.type === 'global' || (repoId !== null && scope.repoId === repoId)
}

export function getQuickCommandBody(command: TerminalQuickCommand): string {
  return isAgentQuickCommand(command) ? command.prompt : command.command
}

export function isQuickCommandComplete(command: TerminalQuickCommand): boolean {
  if (command.label.trim().length === 0) {
    return false
  }
  if (isAgentQuickCommand(command)) {
    return mobileTuiAgentSupportsPromptCommand(command.agent) && command.prompt.trim().length > 0
  }
  return command.command.trim().length > 0
}

export function getQuickCommandAgentLabel(agent: TuiAgent): string {
  return MOBILE_TUI_AGENT_LABELS[agent] ?? agent
}

// The subtitle desktop shows under each quick command: agent prompts read
// "Codex: <prompt>", terminal commands show the raw command text.
export function getQuickCommandPreview(command: TerminalQuickCommand): string {
  if (isAgentQuickCommand(command)) {
    return `${getQuickCommandAgentLabel(command.agent)}: ${command.prompt}`
  }
  return command.command
}

export function getQuickCommandAgentLaunchName(agent: TuiAgent): string {
  return MOBILE_TUI_AGENT_LAUNCH_COMMANDS[agent] ?? agent
}

const LINE_BREAK_RE = /\r\n|\r|\n/

// Why: a terminal-command quick command's lines are independent shell commands;
// joining them into one command list stops a foreground program from reading
// later lines as stdin (mirrors desktop flattenTerminalQuickCommand).
export function flattenQuickCommandText(command: string): string {
  if (!LINE_BREAK_RE.test(command)) {
    return command
  }
  return command
    .split(LINE_BREAK_RE)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('; ')
}

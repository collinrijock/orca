import { describe, expect, it } from 'vitest'
import type { TerminalQuickCommand } from '../../../src/shared/types'
import { buildMobileQuickCommandLaunch } from './quick-commands'

function command(overrides: Partial<TerminalQuickCommand> = {}): TerminalQuickCommand {
  return {
    id: 'command',
    label: 'Command',
    action: 'terminal-command',
    command: 'pnpm test',
    appendEnter: true,
    scope: { type: 'global' },
    ...overrides
  } as TerminalQuickCommand
}

describe('mobile quick-command launch', () => {
  it('preserves multiline shell syntax in runnable startup commands', () => {
    const multiline = "cat <<'EOF'\nhello world\nEOF\nprintf '%s\\n' done"
    expect(buildMobileQuickCommandLaunch(command({ command: multiline }))).toEqual({
      options: { startupCommand: multiline }
    })
  })

  it('keeps append-enter-off commands as unsubmitted terminal input', () => {
    const multiline = 'printf "first\\nsecond"\n# leave this unsubmitted'
    expect(
      buildMobileQuickCommandLaunch(command({ command: multiline, appendEnter: false }))
    ).toEqual({
      options: { initialPrompt: multiline, enter: false }
    })
  })

  it('injects supported agent prompts into the host-built launch command', () => {
    expect(
      buildMobileQuickCommandLaunch(
        command({
          action: 'agent-prompt',
          agent: 'codex',
          prompt: 'Review this diff'
        })
      )
    ).toEqual({ agent: 'codex', options: { agentPrompt: 'Review this diff' } })
  })
})

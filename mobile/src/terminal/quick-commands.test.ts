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
  it('queues runnable terminal commands through shell-ready startup', () => {
    expect(buildMobileQuickCommandLaunch(command({ command: 'pnpm lint\npnpm test' }))).toEqual({
      options: { startupCommand: 'pnpm lint; pnpm test' }
    })
  })

  it('keeps append-enter-off commands as unsubmitted terminal input', () => {
    expect(buildMobileQuickCommandLaunch(command({ appendEnter: false }))).toEqual({
      options: { initialPrompt: 'pnpm test', enter: false }
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

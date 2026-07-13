import { describe, expect, it } from 'vitest'

import type { CommandSpec } from './args'
import { levenshtein, suggestCommands, unknownCommandData } from './command-suggestion'
import { COMMAND_SPECS } from './specs'

const specs: CommandSpec[] = [
  {
    path: ['worktree', 'rm'],
    aliases: [
      ['worktree', 'remove'],
      ['worktree', 'delete']
    ],
    destructive: true,
    summary: 'Remove a worktree',
    usage: 'orca worktree rm',
    allowedFlags: []
  },
  {
    path: ['worktree', 'list'],
    summary: 'List worktrees',
    usage: 'orca worktree list',
    allowedFlags: []
  },
  {
    path: ['terminal', 'send'],
    summary: 'Send input',
    usage: 'orca terminal send',
    allowedFlags: []
  },
  {
    // A destructive command outside the delete-family, to prove the guard keys
    // off the spec flag rather than a hardcoded verb list.
    path: ['emulator', 'kill'],
    destructive: true,
    summary: 'Kill the emulator',
    usage: 'orca emulator kill',
    allowedFlags: []
  }
]

const destructiveProductionPaths = [
  'agent hooks off',
  'automations remove',
  'clear',
  'cookie delete',
  'emulator kill',
  'emulator permissions',
  'emulator shutdown',
  'environment rm',
  'linear assignee clear',
  'linear due-date clear',
  'linear estimate clear',
  'linear label remove',
  'linear priority clear',
  'orchestration reset',
  'orchestration run-stop',
  'project setup-delete',
  'storage local clear',
  'storage session clear',
  'tab close',
  'tab profile delete',
  'terminal close',
  'terminal stop',
  'worktree rm'
]

const destructiveProductionSuggestions = new Set(
  COMMAND_SPECS.filter((spec) => spec.destructive)
    .flatMap((spec) => [spec.path, ...(spec.aliases ?? [])])
    .map((path) => path.join(' '))
)

describe('levenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshtein('rm', 'rm')).toBe(0)
  })

  it('counts single-edit distance', () => {
    expect(levenshtein('remov', 'remove')).toBe(1)
  })

  it('handles empty operands', () => {
    expect(levenshtein('', 'abc')).toBe(3)
    expect(levenshtein('abc', '')).toBe(3)
  })
})

describe('suggestCommands', () => {
  it('returns nothing for a wildly-off token', () => {
    expect(suggestCommands(specs, ['worktree', 'zzzzz'])).toEqual([])
  })

  it('only considers commands of the same depth', () => {
    expect(suggestCommands(specs, ['worktree', 'list', 'extra'])).toEqual([])
  })

  it('suggests a top-level command group near-miss', () => {
    expect(suggestCommands(specs, ['worktre'])).toEqual(['worktree'])
  })

  it('ranks closer matches first', () => {
    const result = suggestCommands(specs, ['terminal', 'sen'])
    expect(result[0]).toBe('terminal send')
  })

  it.each([
    ['worktree', 'remov'],
    ['worktree', 'delet'],
    ['emulator', 'kil'],
    ['emulato', 'kill']
  ])('never suggests destructive commands for %s %s', (...commandPath) => {
    expect(suggestCommands(specs, commandPath)).toEqual([])
  })

  it('still recovers non-destructive near-misses', () => {
    expect(suggestCommands(specs, ['worktree', 'lst'])).toContain('worktree list')
  })
})

describe('production destructive command registry', () => {
  it.each(destructiveProductionPaths)('marks %s as destructive', (commandPath) => {
    const spec = COMMAND_SPECS.find((candidate) => candidate.path.join(' ') === commandPath)
    expect(spec?.destructive).toBe(true)
  })

  it.each([
    ['worktree', 'remov'],
    ['emulator', 'kil'],
    ['orchestration', 'rese']
  ])('never suggests a production destructive command for %s %s', (...commandPath) => {
    for (const suggestion of suggestCommands(COMMAND_SPECS, commandPath)) {
      expect(destructiveProductionSuggestions).not.toContain(suggestion)
    }
  })
})

describe('unknownCommandData', () => {
  it('produces a human nextSteps line for a safe suggestion', () => {
    const data = unknownCommandData(specs, ['worktree', 'lst'])
    expect(data.suggestions).toContain('worktree list')
    expect(data.nextSteps[0]).toContain('Did you mean')
    expect(data.nextSteps[0]).toContain('orca worktree list')
  })

  it('produces empty nextSteps when nothing is close', () => {
    const data = unknownCommandData(specs, ['worktree', 'zzzzz'])
    expect(data.suggestions).toEqual([])
    expect(data.nextSteps).toEqual([])
  })

  it('does not emit nextSteps for a destructive typo', () => {
    const data = unknownCommandData(specs, ['worktree', 'remov'])
    expect(data.suggestions).toEqual([])
    expect(data.nextSteps).toEqual([])
  })
})

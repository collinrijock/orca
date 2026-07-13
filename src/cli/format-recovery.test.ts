import { afterEach, describe, expect, it, vi } from 'vitest'

import { formatCliError, reportCliError } from './format'
import { RuntimeClientError, RuntimeRpcFailureError } from './runtime-client'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('CLI error recovery', () => {
  it('renders explicit local recovery in human output', () => {
    const error = new RuntimeClientError('invalid_argument', 'Unknown command: worktree lst', {
      nextSteps: ['Run `orca help` to inspect available commands.']
    })

    const output = formatCliError(error)

    expect(output).toContain('Unknown command: worktree lst')
    expect(output).toContain('Next step: Run `orca help`')
  })

  it('prefers explicit local recovery over generic computer hints', () => {
    const error = new RuntimeClientError('invalid_argument', 'Unknown flag --forcce', {
      validFlags: ['force', 'json'],
      nextSteps: ['Run `orca help computer click` to inspect supported flags.']
    })

    const output = formatCliError(error, { commandPath: ['computer', 'click'] })

    expect(output).toContain('Next step: Run `orca help computer click`')
    expect(output).not.toContain('Fix the command flags or RPC params')
  })

  it('keeps safe local recovery in JSON errors', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const error = new RuntimeClientError('invalid_argument', 'Unknown command: worktree lst', {
      nextSteps: ['Run `orca help` to inspect available commands.']
    })

    reportCliError(error, true)

    const output = JSON.parse(logSpy.mock.calls.flat().join('\n')) as {
      error: { data?: { nextSteps?: string[] } }
    }
    expect(output.error.data?.nextSteps).toEqual([
      'Run `orca help` to inspect available commands.'
    ])
  })

  it('preserves runtime recovery data in JSON errors', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const error = new RuntimeRpcFailureError({
      id: 'req_rpc_json',
      ok: false,
      error: {
        code: 'invalid_argument',
        message: 'Unknown runtime argument',
        data: {
          detail: 'invalid selector',
          nestedRecovery: { nextSteps: ['Inspect the valid selectors'] },
          nextSteps: ['Inspect the valid selectors']
        }
      },
      _meta: { runtimeId: 'runtime_local' }
    })

    reportCliError(error, true)

    const output = JSON.parse(logSpy.mock.calls.flat().join('\n')) as {
      error: {
        data?: {
          detail?: string
          nestedRecovery?: { nextSteps?: string[] }
          nextSteps?: string[]
        }
      }
    }
    expect(output.error.data).toEqual({
      detail: 'invalid selector',
      nestedRecovery: { nextSteps: ['Inspect the valid selectors'] },
      nextSteps: ['Inspect the valid selectors']
    })
  })

  it('prefers RPC recovery over generic computer hints in text output', () => {
    const error = new RuntimeRpcFailureError({
      id: 'req_rpc_recovery',
      ok: false,
      error: {
        code: 'invalid_argument',
        message: 'Unknown runtime argument',
        data: { nextSteps: ['Use the runtime-specific option'] }
      },
      _meta: { runtimeId: 'runtime_local' }
    })

    const output = formatCliError(error, { commandPath: ['computer', 'click'] })

    expect(output).toContain('Next step: Use the runtime-specific option')
    expect(output).not.toContain('Fix the command flags or RPC params')
  })

  it('keeps generic computer hints when an RPC error has no recovery data', () => {
    const error = new RuntimeRpcFailureError({
      id: 'req_rpc_fallback',
      ok: false,
      error: { code: 'invalid_argument', message: 'Invalid computer argument' },
      _meta: { runtimeId: 'runtime_local' }
    })

    const output = formatCliError(error, { commandPath: ['computer', 'click'] })

    expect(output).toContain('Fix the command flags or RPC params')
  })
})

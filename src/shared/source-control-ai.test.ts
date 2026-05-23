import { describe, expect, it } from 'vitest'
import { getDefaultSettings } from './constants'
import {
  clearSourceControlAiModelChoiceForHost,
  mergeLegacyCommitMessageAiIntoSourceControlAi,
  resolveSourceControlAiForOperation,
  sourceControlAiSettingsFromLegacy
} from './source-control-ai'
import type { RepoSourceControlAiOverrides } from './source-control-ai-types'
import type { GlobalSettings } from './types'

function settings(): GlobalSettings {
  const base = getDefaultSettings('/tmp')
  return {
    ...base,
    defaultTuiAgent: 'codex' as const,
    sourceControlAi: {
      ...base.sourceControlAi!,
      enabled: true,
      agentId: 'codex' as const,
      selectedModelByAgent: { codex: 'gpt-5.5' },
      selectedThinkingByModel: { 'gpt-5.5': 'medium', 'gpt-5.4': 'high' },
      instructionsByOperation: {
        commitMessage: 'Global commit style',
        pullRequest: 'Global PR style'
      }
    }
  }
}

function resolve(
  operation: 'commitMessage' | 'pullRequest',
  overrides?: RepoSourceControlAiOverrides
) {
  const result = resolveSourceControlAiForOperation({
    settings: settings(),
    repo: overrides ? { sourceControlAi: overrides } : null,
    operation,
    discoveryHostKey: 'local',
    prCreationProductDefaults: {
      draft: false,
      useTemplate: false,
      generateDetailsOnOpen: false,
      openAfterCreate: false
    }
  })
  expect(result.ok).toBe(true)
  if (!result.ok) {
    throw new Error(result.error)
  }
  return result.value
}

describe('source-control AI resolution', () => {
  it('uses the global default model for both operations', () => {
    expect(resolve('commitMessage').params.model).toBe('gpt-5.5')
    expect(resolve('pullRequest').params.model).toBe('gpt-5.5')
  })

  it('lets a global operation model override win over the global default', () => {
    const base = settings()
    base.sourceControlAi!.modelOverridesByOperation = {
      pullRequest: { selectedModelByAgent: { codex: 'gpt-5.4' } }
    }
    const result = resolveSourceControlAiForOperation({
      settings: base,
      repo: null,
      operation: 'pullRequest',
      discoveryHostKey: 'local'
    })
    expect(result.ok && result.value.params.model).toBe('gpt-5.4')
  })

  it('lets a repo operation model override win over global operation override', () => {
    const base = settings()
    base.sourceControlAi!.modelOverridesByOperation = {
      commitMessage: { selectedModelByAgent: { codex: 'gpt-5.4' } }
    }
    const result = resolveSourceControlAiForOperation({
      settings: base,
      repo: {
        sourceControlAi: {
          modelOverridesByOperation: {
            commitMessage: { selectedModelByAgent: { codex: 'gpt-5.4-mini' } }
          }
        }
      },
      operation: 'commitMessage',
      discoveryHostKey: 'local'
    })
    expect(result.ok && result.value.params.model).toBe('gpt-5.4-mini')
  })

  it('resolves thinking effort with override precedence and model default fallback', () => {
    expect(resolve('commitMessage').params.thinkingLevel).toBe('medium')
    expect(
      resolve('commitMessage', {
        modelOverridesByOperation: {
          commitMessage: {
            selectedModelByAgent: { codex: 'gpt-5.4' },
            selectedThinkingByModel: { 'gpt-5.4': 'xhigh' }
          }
        }
      }).params.thinkingLevel
    ).toBe('xhigh')

    const base = settings()
    base.sourceControlAi!.selectedThinkingByModel = {
      'gpt-5.5': 'unsupported'
    } as Record<string, string>
    const result = resolveSourceControlAiForOperation({
      settings: base,
      repo: null,
      operation: 'commitMessage',
      discoveryHostKey: 'local'
    })
    expect(result.ok && result.value.params.thinkingLevel).toBe('low')
  })

  it('resolves repo instructions as replacement overrides, including explicit empty', () => {
    expect(resolve('commitMessage').params.customPrompt).toBe('Global commit style')
    expect(
      resolve('commitMessage', {
        instructionsByOperation: { commitMessage: '' }
      }).params.customPrompt
    ).toBe('')
    expect(
      resolve('commitMessage', {
        instructionsByOperation: { commitMessage: 'Repo commit style' }
      }).params.customPrompt
    ).toBe('Repo commit style')
  })

  it('resolves repo tri-state PR defaults through inherit on and off', () => {
    expect(resolve('pullRequest').prCreationDefaults.draft).toBe(false)
    expect(
      resolve('pullRequest', {
        prCreationDefaults: { draft: true, openAfterCreate: false }
      }).prCreationDefaults
    ).toMatchObject({ draft: true, openAfterCreate: false })
  })

  it('maps legacy custom prompt only to commit-message instructions', () => {
    const migrated = sourceControlAiSettingsFromLegacy({
      enabled: true,
      agentId: 'codex',
      selectedModelByAgent: { codex: 'gpt-5.5' },
      selectedThinkingByModel: {},
      customPrompt: 'Legacy commit prompt',
      customAgentCommand: ''
    })
    expect(migrated.instructionsByOperation.commitMessage).toBe('Legacy commit prompt')
    expect(migrated.instructionsByOperation.pullRequest).toBe('')
  })

  it('merges legacy commit-message updates without wiping PR-only settings', () => {
    const base = settings().sourceControlAi!
    const merged = mergeLegacyCommitMessageAiIntoSourceControlAi(base, {
      enabled: false,
      agentId: 'claude',
      selectedModelByAgent: { claude: 'sonnet' },
      selectedThinkingByModel: { sonnet: 'medium' },
      customPrompt: 'Legacy commit prompt',
      customAgentCommand: 'claude'
    })

    expect(merged).toMatchObject({
      enabled: false,
      agentId: 'claude',
      selectedModelByAgent: { claude: 'sonnet' },
      selectedThinkingByModel: { sonnet: 'medium' },
      customAgentCommand: 'claude',
      instructionsByOperation: {
        commitMessage: 'Legacy commit prompt',
        pullRequest: 'Global PR style'
      }
    })
  })

  it('can map explicit legacy PR generation instructions for old runtime callers', () => {
    const merged = mergeLegacyCommitMessageAiIntoSourceControlAi(
      undefined,
      {
        enabled: true,
        agentId: 'codex',
        selectedModelByAgent: { codex: 'gpt-5.5' },
        selectedThinkingByModel: {},
        customPrompt: 'Legacy PR prompt',
        customAgentCommand: ''
      },
      { pullRequestInstructionsFromLegacy: true }
    )

    expect(merged.instructionsByOperation.pullRequest).toBe('Legacy PR prompt')
  })

  it('clears only the selected host model override when inheriting', () => {
    const cleared = clearSourceControlAiModelChoiceForHost(
      {
        selectedModelByAgent: { codex: 'local-model' },
        selectedModelByAgentByHost: {
          local: { codex: 'local-model' },
          'ssh:conn-1': { codex: 'remote-model' }
        },
        selectedThinkingByModel: { 'remote-model': 'high' }
      },
      'local',
      'codex'
    )

    expect(cleared).toEqual({
      selectedModelByAgentByHost: {
        'ssh:conn-1': { codex: 'remote-model' }
      },
      selectedThinkingByModel: { 'remote-model': 'high' }
    })
  })
})

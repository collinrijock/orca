import type { Repo } from '../../../../shared/types'
import type {
  RepoSourceControlAiOverrides,
  SourceControlAiModelChoice,
  SourceControlAiOperation
} from '../../../../shared/source-control-ai-types'
import {
  clearSourceControlAiModelChoiceForHost,
  normalizeSourceControlAiSettings
} from '../../../../shared/source-control-ai'
import {
  getCommitMessageAgentCapability,
  isCustomAgentId,
  resolveCommitMessageAgentChoice
} from '../../../../shared/commit-message-agent-spec'
import { LOCAL_COMMIT_MESSAGE_HOST_KEY } from '../../../../shared/commit-message-host-key'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { useAppStore } from '../../store'
import { getRuntimeGitScope } from '../../runtime/runtime-git-client'
import { getCommitMessageModelDiscoveryHostKeyForScope } from '../../../../shared/commit-message-host-key'
import { getRepositorySourceControlAiSectionId } from './repository-settings-targets'

type RepositorySourceControlAiSectionProps = {
  repo: Repo
  updateRepo: (repoId: string, updates: Partial<Repo>) => void
}

const INHERIT_MODEL_VALUE = '__inherit__'
const PROMPT_MODE_INHERIT = 'inherit'
const PROMPT_MODE_OVERRIDE = 'override'

const OPERATIONS: {
  operation: SourceControlAiOperation
  modelLabel: string
  instructionLabel: string
  globalPlaceholder: string
}[] = [
  {
    operation: 'commitMessage',
    modelLabel: 'Commit message model',
    instructionLabel: 'Commit message instructions',
    globalPlaceholder: 'Global commit message instructions are empty.'
  },
  {
    operation: 'pullRequest',
    modelLabel: 'PR details model',
    instructionLabel: 'Pull request instructions',
    globalPlaceholder: 'Global pull request instructions are empty.'
  }
]

type PrDefaultKey = keyof NonNullable<RepoSourceControlAiOverrides['prCreationDefaults']>

function hasOwnInstruction(
  instructions: RepoSourceControlAiOverrides['instructionsByOperation'],
  operation: SourceControlAiOperation
): boolean {
  return Object.prototype.hasOwnProperty.call(instructions ?? {}, operation)
}

function readChoiceModel(
  choice: SourceControlAiModelChoice | undefined,
  hostKey: string,
  agentId: string
): string | undefined {
  return (
    choice?.selectedModelByAgentByHost?.[hostKey]?.[agentId] ??
    (hostKey === LOCAL_COMMIT_MESSAGE_HOST_KEY
      ? choice?.selectedModelByAgent?.[agentId]
      : undefined)
  )
}

function selectModelForHost(
  choice: SourceControlAiModelChoice | undefined,
  hostKey: string,
  agentId: string,
  modelId: string
): SourceControlAiModelChoice {
  const hostSelectedModels = choice?.selectedModelByAgentByHost?.[hostKey] ?? {}
  return {
    ...choice,
    selectedModelByAgent:
      hostKey === LOCAL_COMMIT_MESSAGE_HOST_KEY
        ? {
            ...choice?.selectedModelByAgent,
            [agentId]: modelId
          }
        : choice?.selectedModelByAgent,
    selectedModelByAgentByHost: {
      ...choice?.selectedModelByAgentByHost,
      [hostKey]: {
        ...hostSelectedModels,
        [agentId]: modelId
      }
    }
  }
}

function triStateValue(value: boolean | null | undefined): 'inherit' | 'on' | 'off' {
  if (value === true) {
    return 'on'
  }
  if (value === false) {
    return 'off'
  }
  return 'inherit'
}

export function RepositorySourceControlAiSection({
  repo,
  updateRepo
}: RepositorySourceControlAiSectionProps): React.JSX.Element {
  const settings = useAppStore((state) => state.settings)
  const source = normalizeSourceControlAiSettings(
    settings?.sourceControlAi,
    settings?.commitMessageAi
  )
  const hostScope = getRuntimeGitScope(settings, repo.connectionId)
  const hostKey = getCommitMessageModelDiscoveryHostKeyForScope(hostScope)
  const agentId = resolveCommitMessageAgentChoice(source.agentId, settings?.defaultTuiAgent)
  const baseCapability =
    agentId && !isCustomAgentId(agentId) ? getCommitMessageAgentCapability(agentId) : null
  const discoveredModels =
    agentId && !isCustomAgentId(agentId)
      ? (source.discoveredModelsByAgentByHost?.[hostKey]?.[agentId] ??
        (hostKey === LOCAL_COMMIT_MESSAGE_HOST_KEY
          ? source.discoveredModelsByAgent?.[agentId]
          : undefined))
      : undefined
  const capability =
    baseCapability && discoveredModels?.length
      ? { ...baseCapability, models: discoveredModels }
      : baseCapability
  const repoAi = repo.sourceControlAi ?? {}

  const writeRepoAi = (next: RepoSourceControlAiOverrides): void => {
    updateRepo(repo.id, { sourceControlAi: next })
  }

  const updateModelOverride = (operation: SourceControlAiOperation, modelId: string): void => {
    if (!capability) {
      return
    }
    const nextModelOverrides = { ...repoAi.modelOverridesByOperation }
    if (modelId === INHERIT_MODEL_VALUE) {
      const nextChoice = clearSourceControlAiModelChoiceForHost(
        nextModelOverrides[operation],
        hostKey,
        capability.id
      )
      if (nextChoice) {
        nextModelOverrides[operation] = nextChoice
      } else {
        delete nextModelOverrides[operation]
      }
      writeRepoAi({ ...repoAi, modelOverridesByOperation: nextModelOverrides })
      return
    }
    const model = capability.models.find((candidate) => candidate.id === modelId)
    if (!model) {
      return
    }
    const nextChoice = selectModelForHost(
      repoAi.modelOverridesByOperation?.[operation],
      hostKey,
      capability.id,
      model.id
    )
    if (model.thinkingLevels && model.defaultThinkingLevel) {
      nextChoice.selectedThinkingByModel = {
        ...nextChoice.selectedThinkingByModel,
        [model.id]: nextChoice.selectedThinkingByModel?.[model.id] ?? model.defaultThinkingLevel
      }
    }
    writeRepoAi({
      ...repoAi,
      modelOverridesByOperation: {
        ...nextModelOverrides,
        [operation]: nextChoice
      }
    })
  }

  const updatePromptMode = (
    operation: SourceControlAiOperation,
    mode: string,
    inheritedValue: string
  ): void => {
    const nextInstructions = { ...repoAi.instructionsByOperation }
    if (mode === PROMPT_MODE_INHERIT) {
      delete nextInstructions[operation]
    } else if (!hasOwnInstruction(nextInstructions, operation)) {
      nextInstructions[operation] = inheritedValue
    }
    writeRepoAi({ ...repoAi, instructionsByOperation: nextInstructions })
  }

  const updatePromptOverride = (operation: SourceControlAiOperation, value: string): void => {
    writeRepoAi({
      ...repoAi,
      instructionsByOperation: {
        ...repoAi.instructionsByOperation,
        [operation]: value
      }
    })
  }

  const updatePrDefault = (key: PrDefaultKey, value: string): void => {
    const nextDefaults = { ...repoAi.prCreationDefaults }
    if (value === 'inherit') {
      delete nextDefaults[key]
    } else {
      nextDefaults[key] = value === 'on'
    }
    writeRepoAi({ ...repoAi, prCreationDefaults: nextDefaults })
  }

  const prDefaultRows: { key: PrDefaultKey; label: string }[] = [
    { key: 'draft', label: 'Draft by default' },
    { key: 'useTemplate', label: 'Use PR template when available' },
    { key: 'generateDetailsOnOpen', label: 'Generate details when opening Create PR' },
    { key: 'openAfterCreate', label: 'Open PR after creation' }
  ]

  return (
    <section
      id={getRepositorySourceControlAiSectionId(repo.id)}
      data-settings-section={getRepositorySourceControlAiSectionId(repo.id)}
      className="space-y-4"
    >
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">Source Control AI</h3>
        <p className="text-xs text-muted-foreground">
          Repo-specific overrides. Each field uses global settings until you set it here.
        </p>
      </div>

      {capability ? (
        <div className="space-y-3">
          {OPERATIONS.map((row) => {
            const choice = repoAi.modelOverridesByOperation?.[row.operation]
            const selectedModelId = readChoiceModel(choice, hostKey, capability.id)
            const selectedModel = selectedModelId
              ? capability.models.find((model) => model.id === selectedModelId)
              : null
            const selectedThinking =
              selectedModel?.thinkingLevels && selectedModel.defaultThinkingLevel
                ? (choice?.selectedThinkingByModel?.[selectedModel.id] ??
                  selectedModel.defaultThinkingLevel)
                : null
            return (
              <div
                key={row.operation}
                className="space-y-2 rounded-md border border-border px-3 py-2"
              >
                <div className="flex items-center justify-between gap-4">
                  <Label className="text-xs font-medium">{row.modelLabel}</Label>
                  <Select
                    value={selectedModelId ?? INHERIT_MODEL_VALUE}
                    onValueChange={(value) => updateModelOverride(row.operation, value)}
                  >
                    <SelectTrigger size="sm" className="h-8 w-[240px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={INHERIT_MODEL_VALUE}>Use global model</SelectItem>
                      {capability.models.map((model) => (
                        <SelectItem key={model.id} value={model.id}>
                          {model.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {selectedModel?.thinkingLevels && selectedThinking ? (
                  <div className="flex items-center justify-end gap-2">
                    <span className="text-[11px] text-muted-foreground">Thinking</span>
                    <Select
                      value={selectedThinking}
                      onValueChange={(value) => {
                        writeRepoAi({
                          ...repoAi,
                          modelOverridesByOperation: {
                            ...repoAi.modelOverridesByOperation,
                            [row.operation]: {
                              ...choice,
                              selectedThinkingByModel: {
                                ...choice?.selectedThinkingByModel,
                                [selectedModel.id]: value
                              }
                            }
                          }
                        })
                      }}
                    >
                      <SelectTrigger size="sm" className="h-7 w-[150px] text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {selectedModel.thinkingLevels.map((level) => (
                          <SelectItem key={level.id} value={level.id}>
                            {level.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : (
        <p className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
          Model overrides are available after a supported global Source Control AI agent is
          selected.
        </p>
      )}

      <div className="space-y-3">
        {OPERATIONS.map((row) => {
          const inherited = source.instructionsByOperation[row.operation]?.trim() ?? ''
          const hasOverride = hasOwnInstruction(repoAi.instructionsByOperation, row.operation)
          const value = hasOverride ? (repoAi.instructionsByOperation?.[row.operation] ?? '') : ''
          return (
            <div key={row.instructionLabel} className="space-y-2">
              <div className="flex items-center justify-between gap-4">
                <Label className="text-xs font-medium">{row.instructionLabel}</Label>
                <Select
                  value={hasOverride ? PROMPT_MODE_OVERRIDE : PROMPT_MODE_INHERIT}
                  onValueChange={(mode) => updatePromptMode(row.operation, mode, inherited)}
                >
                  <SelectTrigger size="sm" className="h-8 w-[150px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={PROMPT_MODE_INHERIT}>Use global</SelectItem>
                    <SelectItem value={PROMPT_MODE_OVERRIDE}>Customize</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <textarea
                rows={3}
                value={hasOverride ? value : ''}
                onChange={(event) => updatePromptOverride(row.operation, event.target.value)}
                disabled={!hasOverride}
                placeholder={hasOverride ? '' : inherited || row.globalPlaceholder}
                className="w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground/70 focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:bg-muted/40"
              />
            </div>
          )
        })}
      </div>

      <div className="space-y-2">
        <Label className="text-xs font-medium">PR creation defaults</Label>
        <div className="space-y-2">
          {prDefaultRows.map((row) => (
            <div
              key={row.key}
              className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2"
            >
              <span className="text-xs text-foreground">{row.label}</span>
              <Select
                value={triStateValue(repoAi.prCreationDefaults?.[row.key])}
                onValueChange={(value) => updatePrDefault(row.key, value)}
              >
                <SelectTrigger size="sm" className="h-8 w-[120px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="inherit">Use global</SelectItem>
                  <SelectItem value="on">On</SelectItem>
                  <SelectItem value="off">Off</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

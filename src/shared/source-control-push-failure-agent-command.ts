import {
  DEFAULT_SOURCE_CONTROL_ACTION_COMMAND_TEMPLATES,
  renderSourceControlActionCommandTemplate
} from './source-control-ai-actions'

export function buildPushFailureAgentCommandInput({
  promptOverride,
  commandInputTemplate,
  basePrompt
}: {
  promptOverride?: string
  commandInputTemplate?: string | null
  basePrompt: string
}): string {
  return (
    promptOverride ??
    renderSourceControlActionCommandTemplate(
      commandInputTemplate ?? DEFAULT_SOURCE_CONTROL_ACTION_COMMAND_TEMPLATES.fixPushFailure,
      { basePrompt }
    )
  ).trim()
}

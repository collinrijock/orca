import { translate } from '@/i18n/i18n'
import { searchKeywords } from './settings-search-keywords'

export function getManagedAgentSkillSetupPromptsTitle(): string {
  return translate(
    'auto.components.settings.managed.agent.skill.setup.prompts.title',
    'Show agent skill setup prompts'
  )
}

export function getManagedAgentSkillSetupPromptsDescription(): string {
  return translate(
    'auto.components.settings.managed.agent.skill.setup.prompts.description',
    'When an Orca workflow needs a missing or outdated managed skill, show a prompt to install or update it.'
  )
}

export function getManagedAgentSkillSetupPromptsSearchKeywords(): string[] {
  return searchKeywords([
    {
      key: 'auto.components.settings.managed.agent.skill.setup.prompts.search.agent',
      fallback: 'agent'
    },
    {
      key: 'auto.components.settings.managed.agent.skill.setup.prompts.search.skills',
      fallback: 'skills'
    },
    {
      key: 'auto.components.settings.managed.agent.skill.setup.prompts.search.setup',
      fallback: 'setup'
    },
    {
      key: 'auto.components.settings.managed.agent.skill.setup.prompts.search.prompt',
      fallback: 'prompt'
    },
    {
      key: 'auto.components.settings.managed.agent.skill.setup.prompts.search.install',
      fallback: 'install'
    },
    {
      key: 'auto.components.settings.managed.agent.skill.setup.prompts.search.update',
      fallback: 'update'
    }
  ])
}

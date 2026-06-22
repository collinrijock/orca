import { describe, expect, it } from 'vitest'
import {
  buildAgentFeatureSkillInstallCommand,
  buildAgentFeatureSkillUpdateCommand,
  COMPUTER_USE_SKILL_UPDATE_COMMAND,
  LINEAR_TICKETS_SKILL_UPDATE_COMMAND,
  ORCA_LINEAR_SKILL_UPDATE_COMMAND,
  ORCA_CLI_ORCHESTRATION_SKILL_INSTALL_COMMAND,
  ORCA_CLI_SKILL_UPDATE_COMMAND,
  ORCHESTRATION_SKILL_UPDATE_COMMAND
} from './agent-feature-install-commands'

describe('agent feature skill commands', () => {
  it('builds single-skill update commands', () => {
    expect(buildAgentFeatureSkillUpdateCommand('orchestration')).toBe(
      'npx --yes skills update orchestration --global --yes'
    )
  })

  it('trims and rejects blank update skill names', () => {
    expect(buildAgentFeatureSkillUpdateCommand('  orca-cli  ')).toBe(
      'npx --yes skills update orca-cli --global --yes'
    )
    expect(() => buildAgentFeatureSkillUpdateCommand('   ')).toThrow('A skill name is required.')
  })

  it('exports single-skill update constants without changing install bundles', () => {
    expect(ORCA_CLI_SKILL_UPDATE_COMMAND).toBe('npx --yes skills update orca-cli --global --yes')
    expect(COMPUTER_USE_SKILL_UPDATE_COMMAND).toBe(
      'npx --yes skills update computer-use --global --yes'
    )
    expect(ORCHESTRATION_SKILL_UPDATE_COMMAND).toBe(
      'npx --yes skills update orchestration --global --yes'
    )
    expect(LINEAR_TICKETS_SKILL_UPDATE_COMMAND).toBe(
      'npx --yes skills update linear-tickets --global --yes'
    )
    expect(ORCA_LINEAR_SKILL_UPDATE_COMMAND).toBe(
      'npx --yes skills update orca-linear --global --yes'
    )
    expect(ORCA_CLI_ORCHESTRATION_SKILL_INSTALL_COMMAND).toBe(
      buildAgentFeatureSkillInstallCommand(['orca-cli', 'orchestration'])
    )
  })
})

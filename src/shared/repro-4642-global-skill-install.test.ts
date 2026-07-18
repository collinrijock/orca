import { describe, expect, it } from 'vitest'
import {
  buildAgentFeatureSkillInstallCommand,
  ORCHESTRATION_SKILL_INSTALL_COMMAND,
  COMPUTER_USE_SKILL_INSTALL_COMMAND
} from './agent-feature-install-commands'

/**
 * Repro for issue #4642: Orca generates `npx skills add ... --global` for skill
 * installation, but PromptScript (the only skill target Orca actually reads)
 * cannot install globally. The `skills` CLI still exits 0 with a success banner,
 * so users run the documented command, see "Installed 1 skill", and the skill
 * never appears in Orca.
 *
 * Root cause: src/shared/agent-feature-install-commands.ts:15 hardcodes the
 * `--global` flag onto every generated install command.
 *
 * These assertions PIN THE BUG: they pass on the current tree while asserting
 * the WRONG (buggy) `--global` command string. The CORRECT behavior (tracked in
 * PR #6580) is a project-scoped install (`-y`, no `--global`) so PromptScript is
 * written to ./.agents/skills/... where Orca's discovery can see it.
 */
describe('issue #4642: --global skill install silently skips PromptScript target', () => {
  it('BUG: generated install command carries --global (PromptScript cannot install globally)', () => {
    const command = buildAgentFeatureSkillInstallCommand(['orchestration'])

    // Buggy current output — the `--global` flag is exactly what makes the
    // PromptScript target fail while the CLI still exits 0.
    expect(command).toBe(
      'npx skills add https://github.com/stablyai/orca --skill orchestration --global'
    )
    expect(command).toContain('--global')

    // Correct behavior would omit --global and use a project-scoped install, e.g.:
    //   'npx skills add https://github.com/stablyai/orca --skill orchestration -y'
    // The following assertions document what SHOULD hold once fixed (they fail today):
    // expect(command).not.toContain('--global')
    // expect(command).toContain('-y')
  })

  it('BUG: every exported install constant is --global-scoped', () => {
    // These are the constants the UI/reminders surface to the user, all buggy.
    expect(ORCHESTRATION_SKILL_INSTALL_COMMAND).toContain('--global')
    expect(COMPUTER_USE_SKILL_INSTALL_COMMAND).toContain('--global')
  })
})

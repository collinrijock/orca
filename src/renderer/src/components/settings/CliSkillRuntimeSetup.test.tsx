import { describe, expect, it } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import {
  buildAgentFeatureSkillInstallCommand,
  ORCA_CLI_SKILL_UPDATE_COMMAND,
  ORCHESTRATION_SKILL_UPDATE_COMMAND
} from '../../../../shared/agent-feature-install-commands'
import {
  buildSkillCommandForRuntime,
  buildSkillInstallCommandForRuntime,
  getSelectedAgentRuntime,
  getSkillDiscoveryTargetForRuntime
} from './CliSkillRuntimeSetup'

describe('CliSkillRuntimeSetup runtime helpers', () => {
  it('wraps WSL skill installs in the selected distro login shell', () => {
    const command = buildSkillInstallCommandForRuntime('npx skills add orchestration --global', {
      runtime: 'wsl',
      wslDistro: 'Ubuntu',
      label: 'WSL Ubuntu'
    })

    expect(command).toContain("wsl.exe -d 'Ubuntu' -- sh -c")
    expect(command).toContain('getent passwd')
    expect(command).toContain('npx skills add orchestration --global')
  })

  it('wraps WSL skill updates with the same selected distro login shell', () => {
    const command = buildSkillCommandForRuntime(
      ORCHESTRATION_SKILL_UPDATE_COMMAND,
      {
        runtime: 'wsl',
        wslDistro: 'Fedora Remix',
        label: 'WSL Fedora Remix'
      },
      'win32'
    )

    expect(command).toContain("wsl.exe -d 'Fedora Remix' -- sh -c")
    expect(command).toContain('getent passwd')
    expect(command).toContain(ORCHESTRATION_SKILL_UPDATE_COMMAND)
  })

  it('reinstalls Windows-host skill updates through the add path', () => {
    expect(
      buildSkillCommandForRuntime(
        ORCHESTRATION_SKILL_UPDATE_COMMAND,
        {
          runtime: 'host',
          label: 'Windows'
        },
        'win32'
      )
    ).toBe(buildAgentFeatureSkillInstallCommand(['orchestration']))
  })

  it('reinstalls legacy-shape Windows-host skill updates through the add path', () => {
    expect(
      buildSkillCommandForRuntime(
        'npx skills update orchestration --global',
        {
          runtime: 'host',
          label: 'Windows'
        },
        'win32'
      )
    ).toBe(buildAgentFeatureSkillInstallCommand(['orchestration']))
  })

  it('treats missing runtime as a Windows host fallback for skill updates', () => {
    expect(buildSkillCommandForRuntime(ORCA_CLI_SKILL_UPDATE_COMMAND, undefined, 'win32')).toBe(
      buildAgentFeatureSkillInstallCommand(['orca-cli'])
    )
  })

  it('keeps non-Windows host skill updates on the update path', () => {
    expect(
      buildSkillCommandForRuntime(
        ORCHESTRATION_SKILL_UPDATE_COMMAND,
        {
          runtime: 'host',
          label: 'This device'
        },
        'linux'
      )
    ).toBe(ORCHESTRATION_SKILL_UPDATE_COMMAND)
  })

  it('preserves the selected WSL distro for skill discovery', () => {
    expect(
      getSkillDiscoveryTargetForRuntime({
        runtime: 'wsl',
        wslDistro: 'Ubuntu',
        label: 'WSL Ubuntu'
      })
    ).toEqual({ runtime: 'wsl', wslDistro: 'Ubuntu' })
  })

  it('uses the global project runtime default instead of stale WSL agent location', () => {
    expect(
      getSelectedAgentRuntime(
        {
          ...getDefaultSettings('/tmp'),
          localAgentRuntime: 'wsl',
          localAgentWslDistro: 'Debian',
          terminalWindowsShell: 'wsl.exe',
          terminalWindowsWslDistro: 'Debian',
          localWindowsRuntimeDefault: { kind: 'windows-host' }
        },
        true,
        true,
        false
      )
    ).toMatchObject({ runtime: 'host' })
  })

  it('uses the WSL global project runtime default instead of stale host agent location', () => {
    expect(
      getSelectedAgentRuntime(
        {
          ...getDefaultSettings('/tmp'),
          localAgentRuntime: 'host',
          terminalWindowsShell: 'powershell.exe',
          localWindowsRuntimeDefault: { kind: 'wsl', distro: 'Ubuntu' }
        },
        true,
        true,
        false
      )
    ).toEqual({ runtime: 'wsl', wslDistro: 'Ubuntu', label: 'WSL Ubuntu' })
  })
})

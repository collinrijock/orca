import { describe, expect, it } from 'vitest'
import {
  applyTerminalGitCredentialPromptGuard,
  TERMINAL_GIT_CREDENTIAL_GUARD_POLICY_ENV,
  TERMINAL_GIT_CREDENTIAL_GUARD_STATE_ENV
} from './terminal-git-credential-guard'

// The load-bearing markers against Git Credential Manager's OAuth popup.
function isGuarded(env: Record<string, string>): boolean {
  return env.GIT_TERMINAL_PROMPT === '0' && env.GCM_INTERACTIVE === 'never'
}

describe('applyTerminalGitCredentialPromptGuard', () => {
  it('guards an agent terminal on every platform, even when user-terminal suppression is off', () => {
    for (const platform of ['win32', 'darwin', 'linux'] as const) {
      const env: Record<string, string> = { PATH: '/usr/bin' }
      applyTerminalGitCredentialPromptGuard(env, {
        launchCommand: 'claude',
        suppressUserTerminalPrompt: false,
        platform
      })
      expect(isGuarded(env), platform).toBe(true)
      // Never empties the credential helper — cached auth must keep working.
      expect(env.GIT_CONFIG_COUNT).toBeDefined()
      expect(Object.values(env)).not.toContain('credential.helper')
    }
  })

  it('guards a plain user terminal by default on a Windows host', () => {
    const env: Record<string, string> = { PATH: '/usr/bin' }
    applyTerminalGitCredentialPromptGuard(env, {
      launchCommand: undefined,
      suppressUserTerminalPrompt: true,
      platform: 'win32'
    })
    expect(isGuarded(env)).toBe(true)
  })

  it('registers the guard in WSLENV on Windows so WSL-routed git sees it too', () => {
    const env: Record<string, string> = { PATH: '/usr/bin' }
    applyTerminalGitCredentialPromptGuard(env, {
      launchCommand: undefined,
      suppressUserTerminalPrompt: true,
      platform: 'win32'
    })
    const wslenvKeys = (env.WSLENV ?? '').split(':')
    expect(wslenvKeys).toContain('GIT_TERMINAL_PROMPT')
    expect(wslenvKeys).toContain('GCM_INTERACTIVE')
    expect(wslenvKeys).toContain('GIT_CONFIG_COUNT')
    expect(wslenvKeys).toContain('GIT_CONFIG_KEY_0')
    expect(wslenvKeys).toContain('GIT_CONFIG_VALUE_0')
    expect(wslenvKeys).toContain(TERMINAL_GIT_CREDENTIAL_GUARD_STATE_ENV)
    // Windows askpass paths are meaningless inside a distro.
    expect(wslenvKeys).not.toContain('GIT_ASKPASS')
    expect(wslenvKeys).not.toContain('SSH_ASKPASS')
  })

  it('guards a headless one-shot agent launch — it can answer a prompt even less than a TUI', () => {
    const env: Record<string, string> = { PATH: '/usr/bin' }
    applyTerminalGitCredentialPromptGuard(env, {
      launchCommand: 'claude -p "fix the tests"',
      suppressUserTerminalPrompt: false,
      platform: 'darwin'
    })
    expect(isGuarded(env)).toBe(true)
  })

  it('never materializes an empty askpass into a sparse daemon wire env, but keeps a caller-set one', () => {
    const sparse: Record<string, string> = { PATH: '/usr/bin' }
    applyTerminalGitCredentialPromptGuard(sparse, {
      launchCommand: 'claude',
      suppressUserTerminalPrompt: true,
      platform: 'win32',
      deferGitConfigGuardToHost: true
    })
    expect(sparse.GIT_ASKPASS).toBeUndefined()
    expect(sparse.SSH_ASKPASS).toBeUndefined()

    const withAskpass: Record<string, string> = { PATH: '/usr/bin', GIT_ASKPASS: 'C:\\feeder.exe' }
    applyTerminalGitCredentialPromptGuard(withAskpass, {
      launchCommand: 'claude',
      suppressUserTerminalPrompt: true,
      platform: 'win32',
      deferGitConfigGuardToHost: true
    })
    expect(withAskpass.GIT_ASKPASS).toBe('C:\\feeder.exe')
    expect(sparse[TERMINAL_GIT_CREDENTIAL_GUARD_POLICY_ENV]).toBe('guard')
  })

  it('defers only indexed config guards for a daemon while keeping fail-fast markers', () => {
    const sparse: Record<string, string> = {
      PATH: '/usr/bin',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.quotePath',
      GIT_CONFIG_VALUE_0: 'false'
    }
    applyTerminalGitCredentialPromptGuard(sparse, {
      launchCommand: 'claude',
      suppressUserTerminalPrompt: true,
      platform: 'win32',
      deferGitConfigGuardToHost: true
    })

    expect(sparse.GIT_TERMINAL_PROMPT).toBe('0')
    expect(sparse.GCM_INTERACTIVE).toBe('never')
    expect(sparse.GIT_CONFIG_COUNT).toBe('1')
    expect(sparse.GIT_CONFIG_KEY_0).toBe('core.quotePath')
    expect(sparse.GIT_CONFIG_KEY_1).toBeUndefined()
    expect(sparse.WSLENV).toBeUndefined()
    expect(sparse[TERMINAL_GIT_CREDENTIAL_GUARD_POLICY_ENV]).toBe('guard')
  })

  it('restores only Orca-owned values when a nested Windows terminal opts out', () => {
    const original: Record<string, string> = {
      PATH: '/usr/bin',
      GIT_TERMINAL_PROMPT: '1',
      GCM_INTERACTIVE: 'force',
      GIT_ASKPASS: 'C:\\user-askpass.exe',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.quotePath',
      GIT_CONFIG_VALUE_0: 'false',
      WSLENV: 'USER_VALUE/p'
    }
    const env = { ...original }
    applyTerminalGitCredentialPromptGuard(env, {
      launchCommand: 'claude',
      suppressUserTerminalPrompt: false,
      platform: 'win32'
    })
    expect(env[TERMINAL_GIT_CREDENTIAL_GUARD_STATE_ENV]).toBeDefined()
    expect(env.GIT_CONFIG_COUNT).toBe('3')

    applyTerminalGitCredentialPromptGuard(env, {
      launchCommand: '/bin/zsh',
      suppressUserTerminalPrompt: false,
      platform: 'win32'
    })

    expect(env).toEqual(original)
  })

  it('clears an inherited Orca guard from a non-Windows user terminal', () => {
    const env: Record<string, string> = { PATH: '/usr/bin' }
    applyTerminalGitCredentialPromptGuard(env, {
      launchCommand: 'claude',
      suppressUserTerminalPrompt: false,
      platform: 'linux'
    })
    expect(isGuarded(env)).toBe(true)

    applyTerminalGitCredentialPromptGuard(env, {
      launchCommand: '/bin/zsh',
      suppressUserTerminalPrompt: true,
      platform: 'linux'
    })

    expect(env).toEqual({ PATH: '/usr/bin' })
  })

  it('reasserts a damaged inherited guard and later restores external changes', () => {
    const env: Record<string, string> = { PATH: '/usr/bin' }
    applyTerminalGitCredentialPromptGuard(env, {
      launchCommand: 'claude',
      suppressUserTerminalPrompt: false,
      platform: 'win32'
    })
    env.GIT_TERMINAL_PROMPT = '1'
    env.GIT_CONFIG_VALUE_0 = 'true'
    env.WSLENV = (env.WSLENV ?? '')
      .split(':')
      .filter((token) => token !== 'GCM_INTERACTIVE')
      .join(':')

    applyTerminalGitCredentialPromptGuard(env, {
      launchCommand: 'codex',
      suppressUserTerminalPrompt: false,
      platform: 'win32'
    })

    expect(isGuarded(env)).toBe(true)
    expect(env.GIT_CONFIG_COUNT).toBe('3')
    expect(env.GIT_CONFIG_KEY_1).toBe('credential.interactive')
    expect(env.GIT_CONFIG_VALUE_1).toBe('false')
    expect((env.WSLENV ?? '').split(':')).toContain('GCM_INTERACTIVE')

    applyTerminalGitCredentialPromptGuard(env, {
      launchCommand: '/bin/zsh',
      suppressUserTerminalPrompt: false,
      platform: 'win32'
    })
    expect(env.GIT_TERMINAL_PROMPT).toBe('1')
    expect(env.GIT_CONFIG_COUNT).toBe('1')
    expect(env.GIT_CONFIG_VALUE_0).toBe('true')
    expect(Object.values(env)).not.toContain('credential.guiPrompt')
  })

  it('reasserts after a later indexed entry overrides the owned guard', () => {
    const env: Record<string, string> = { PATH: '/usr/bin' }
    applyTerminalGitCredentialPromptGuard(env, {
      launchCommand: 'claude',
      suppressUserTerminalPrompt: false,
      platform: 'linux'
    })
    env.GIT_CONFIG_COUNT = '3'
    env.GIT_CONFIG_KEY_2 = 'credential.interactive'
    env.GIT_CONFIG_VALUE_2 = 'true'

    applyTerminalGitCredentialPromptGuard(env, {
      launchCommand: 'codex',
      suppressUserTerminalPrompt: false,
      platform: 'linux'
    })

    expect(env.GIT_CONFIG_COUNT).toBe('3')
    expect(env.GIT_CONFIG_KEY_0).toBe('credential.interactive')
    expect(env.GIT_CONFIG_VALUE_0).toBe('true')
    expect(env.GIT_CONFIG_KEY_1).toBe('credential.interactive')
    expect(env.GIT_CONFIG_VALUE_1).toBe('false')
    expect(env.GIT_CONFIG_KEY_2).toBe('credential.guiPrompt')

    applyTerminalGitCredentialPromptGuard(env, {
      launchCommand: '/bin/zsh',
      suppressUserTerminalPrompt: false,
      platform: 'linux'
    })
    expect(env.GIT_CONFIG_COUNT).toBe('1')
    expect(env.GIT_CONFIG_VALUE_0).toBe('true')
  })

  it('removes untouched owned config while preserving a partially modified entry', () => {
    const env: Record<string, string> = { PATH: '/usr/bin' }
    applyTerminalGitCredentialPromptGuard(env, {
      launchCommand: 'claude',
      suppressUserTerminalPrompt: false,
      platform: 'linux'
    })
    env.GIT_CONFIG_VALUE_0 = 'true'

    applyTerminalGitCredentialPromptGuard(env, {
      launchCommand: 'codex',
      suppressUserTerminalPrompt: false,
      platform: 'linux'
    })
    applyTerminalGitCredentialPromptGuard(env, {
      launchCommand: '/bin/zsh',
      suppressUserTerminalPrompt: false,
      platform: 'linux'
    })

    expect(env.GIT_CONFIG_COUNT).toBe('1')
    expect(env.GIT_CONFIG_KEY_0).toBe('credential.interactive')
    expect(env.GIT_CONFIG_VALUE_0).toBe('true')
    expect(Object.values(env)).not.toContain('credential.guiPrompt')
  })

  it.each([false, true])(
    'transfers WSL forwarding when caller repurposes an owned slot (later token: %s)',
    (addLaterToken) => {
      const env: Record<string, string> = { PATH: '/usr/bin' }
      applyTerminalGitCredentialPromptGuard(env, {
        launchCommand: 'claude',
        suppressUserTerminalPrompt: false,
        platform: 'win32'
      })
      env.GIT_CONFIG_KEY_0 = 'user.key'
      env.GIT_CONFIG_VALUE_0 = 'caller-value'
      if (addLaterToken) {
        env.WSLENV += ':LATER/u'
      }

      applyTerminalGitCredentialPromptGuard(env, {
        launchCommand: '/bin/zsh',
        suppressUserTerminalPrompt: false,
        platform: 'win32'
      })

      expect(env.GIT_CONFIG_COUNT).toBe('1')
      expect(env.GIT_CONFIG_KEY_0).toBe('user.key')
      const wslenv = (env.WSLENV ?? '').split(':')
      expect(wslenv).toContain('GIT_CONFIG_COUNT')
      expect(wslenv).toContain('GIT_CONFIG_KEY_0')
      expect(wslenv).toContain('GIT_CONFIG_VALUE_0')
      expect(wslenv).not.toContain('GIT_CONFIG_KEY_1')
      expect(wslenv).not.toContain('GIT_CONFIG_VALUE_1')
      if (addLaterToken) {
        expect(wslenv).toContain('LATER/u')
      }
    }
  )

  it('does not add WSL count without a complete caller forwarding protocol', () => {
    const env: Record<string, string> = {
      PATH: '/usr/bin',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'user.key',
      GIT_CONFIG_VALUE_0: 'caller-value',
      WSLENV: 'PRE/u'
    }
    applyTerminalGitCredentialPromptGuard(env, {
      launchCommand: 'claude',
      suppressUserTerminalPrompt: false,
      platform: 'win32'
    })
    env.WSLENV += ':LATER/u'

    applyTerminalGitCredentialPromptGuard(env, {
      launchCommand: '/bin/zsh',
      suppressUserTerminalPrompt: false,
      platform: 'win32'
    })

    expect(env.WSLENV).toBe('PRE/u:LATER/u')
  })

  it('upgrades scalar-only ownership when caller indexed config becomes valid', () => {
    const env: Record<string, string> = {
      PATH: '/usr/bin',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'user.key'
    }
    applyTerminalGitCredentialPromptGuard(env, {
      launchCommand: 'claude',
      suppressUserTerminalPrompt: false,
      platform: 'win32'
    })
    expect(env.GIT_CONFIG_COUNT).toBe('1')
    env.GIT_CONFIG_VALUE_0 = 'repaired'

    applyTerminalGitCredentialPromptGuard(env, {
      launchCommand: 'codex',
      suppressUserTerminalPrompt: false,
      platform: 'win32'
    })

    expect(env.GIT_CONFIG_COUNT).toBe('3')
    expect(env.GIT_CONFIG_KEY_1).toBe('credential.interactive')
    expect(env.GIT_CONFIG_KEY_2).toBe('credential.guiPrompt')
    expect((env.WSLENV ?? '').split(':')).toContain('GIT_CONFIG_KEY_2')
  })

  it('keeps the WSL count token when clearing before caller-appended config', () => {
    const env: Record<string, string> = { PATH: '/usr/bin' }
    applyTerminalGitCredentialPromptGuard(env, {
      launchCommand: 'claude',
      suppressUserTerminalPrompt: false,
      platform: 'win32'
    })
    env.GIT_CONFIG_COUNT = '3'
    env.GIT_CONFIG_KEY_2 = 'user.key'
    env.GIT_CONFIG_VALUE_2 = 'caller-value'
    env.WSLENV = `${env.WSLENV}:GIT_CONFIG_KEY_2:GIT_CONFIG_VALUE_2`

    applyTerminalGitCredentialPromptGuard(env, {
      launchCommand: '/bin/zsh',
      suppressUserTerminalPrompt: false,
      platform: 'win32'
    })

    expect(env.GIT_CONFIG_COUNT).toBe('1')
    expect(env.GIT_CONFIG_KEY_0).toBe('user.key')
    expect(env.GIT_CONFIG_VALUE_0).toBe('caller-value')
    const wslenv = (env.WSLENV ?? '').split(':')
    expect(wslenv).toContain('GIT_CONFIG_COUNT')
    expect(wslenv).toContain('GIT_CONFIG_KEY_0')
    expect(wslenv).toContain('GIT_CONFIG_VALUE_0')
  })

  it('preserves caller WSL token variants while removing exact Orca-owned tokens', () => {
    const env: Record<string, string> = {
      PATH: '/usr/bin',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'user.before',
      GIT_CONFIG_VALUE_0: 'before',
      WSLENV: 'PRE/p:GIT_CONFIG_KEY_1/p:GIT_CONFIG_VALUE_1/l'
    }
    applyTerminalGitCredentialPromptGuard(env, {
      launchCommand: 'claude',
      suppressUserTerminalPrompt: false,
      platform: 'win32'
    })
    env.GIT_CONFIG_COUNT = '4'
    env.GIT_CONFIG_KEY_3 = 'user.after'
    env.GIT_CONFIG_VALUE_3 = 'after'
    env.WSLENV += ':GIT_CONFIG_KEY_3/u:GIT_CONFIG_VALUE_3/w:GIT_CONFIG_KEY_2/p'

    applyTerminalGitCredentialPromptGuard(env, {
      launchCommand: '/bin/zsh',
      suppressUserTerminalPrompt: false,
      platform: 'win32'
    })

    expect(env.GIT_CONFIG_COUNT).toBe('2')
    expect(env.GIT_CONFIG_KEY_0).toBe('user.before')
    expect(env.GIT_CONFIG_KEY_1).toBe('user.after')
    const wslenv = (env.WSLENV ?? '').split(':')
    expect(wslenv).toContain('GIT_CONFIG_COUNT')
    expect(wslenv).toContain('GIT_CONFIG_KEY_1/p')
    expect(wslenv).toContain('GIT_CONFIG_VALUE_1/l')
    expect(wslenv).toContain('GIT_CONFIG_KEY_1/u')
    expect(wslenv).toContain('GIT_CONFIG_VALUE_1/w')
    expect(wslenv).toContain('GIT_CONFIG_KEY_2/p')
    expect(wslenv).not.toContain(TERMINAL_GIT_CREDENTIAL_GUARD_STATE_ENV)
  })

  it('keeps scalar guards when externally removed config makes indexed state ambiguous', () => {
    const env: Record<string, string> = { PATH: '/usr/bin' }
    applyTerminalGitCredentialPromptGuard(env, {
      launchCommand: 'claude',
      suppressUserTerminalPrompt: false,
      platform: 'linux'
    })
    delete env.GIT_CONFIG_KEY_0

    applyTerminalGitCredentialPromptGuard(env, {
      launchCommand: 'codex',
      suppressUserTerminalPrompt: false,
      platform: 'linux'
    })

    expect(isGuarded(env)).toBe(true)
    expect(env.GIT_ASKPASS).toBe('')
    expect(env.SSH_ASKPASS).toBe('')
    expect(env.GIT_CONFIG_COUNT).toBe('2')
    expect(env.GIT_CONFIG_KEY_0).toBeUndefined()

    applyTerminalGitCredentialPromptGuard(env, {
      launchCommand: '/bin/zsh',
      suppressUserTerminalPrompt: false,
      platform: 'linux'
    })
    expect(env.GIT_TERMINAL_PROMPT).toBeUndefined()
    expect(env.GIT_CONFIG_COUNT).toBe('2')
    expect(env.GIT_CONFIG_KEY_0).toBeUndefined()
  })

  it.each(['bogus', '-1', '0'])(
    'round-trips ambiguous indexed config with count %s without overwriting it',
    (count) => {
      const original: Record<string, string> = {
        PATH: '/usr/bin',
        GIT_CONFIG_COUNT: count,
        GIT_CONFIG_KEY_0: 'user.key',
        GIT_CONFIG_VALUE_0: 'caller-value',
        WSLENV: 'USER_VALUE/p'
      }
      const env = { ...original }
      applyTerminalGitCredentialPromptGuard(env, {
        launchCommand: 'claude',
        suppressUserTerminalPrompt: false,
        platform: 'win32'
      })

      expect(isGuarded(env)).toBe(true)
      expect(env.GIT_CONFIG_COUNT).toBe(count)
      expect(env.GIT_CONFIG_KEY_0).toBe('user.key')
      expect((env.WSLENV ?? '').split(':')).not.toContain('GIT_CONFIG_COUNT')

      applyTerminalGitCredentialPromptGuard(env, {
        launchCommand: '/bin/zsh',
        suppressUserTerminalPrompt: false,
        platform: 'win32'
      })
      expect(env).toEqual(original)
    }
  )

  it('sends a clear policy when a detached host must remove its inherited guard', () => {
    const env: Record<string, string> = { PATH: '/usr/bin' }
    applyTerminalGitCredentialPromptGuard(env, {
      launchCommand: '/bin/zsh',
      suppressUserTerminalPrompt: false,
      platform: 'win32',
      deferGitConfigGuardToHost: true
    })

    expect(env).toEqual({
      PATH: '/usr/bin',
      [TERMINAL_GIT_CREDENTIAL_GUARD_POLICY_ENV]: 'clear'
    })
  })

  it('never rewrites the terminal locale — the git-runner locale pins must not leak into a shell', () => {
    const env: Record<string, string> = { PATH: '/usr/bin', LC_ALL: 'ja_JP.UTF-8' }
    applyTerminalGitCredentialPromptGuard(env, {
      launchCommand: 'claude',
      suppressUserTerminalPrompt: true,
      platform: 'win32'
    })
    expect(isGuarded(env)).toBe(true)
    expect(env.LC_ALL).toBe('ja_JP.UTF-8')
    expect(env.LANG).toBeUndefined()
    expect(env.LANGUAGE).toBeUndefined()
  })

  it('leaves a user terminal untouched on non-Windows hosts — no popup exists there, only working tty prompts', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      const env: Record<string, string> = { PATH: '/usr/bin' }
      applyTerminalGitCredentialPromptGuard(env, {
        launchCommand: '/bin/zsh',
        suppressUserTerminalPrompt: true,
        platform
      })
      expect(env, platform).toEqual({ PATH: '/usr/bin' })
    }
  })

  it('leaves a Windows user terminal untouched when the user opts out', () => {
    const env: Record<string, string> = { PATH: '/usr/bin' }
    applyTerminalGitCredentialPromptGuard(env, {
      launchCommand: '/bin/zsh',
      suppressUserTerminalPrompt: false,
      platform: 'win32'
    })
    expect(env.GIT_TERMINAL_PROMPT).toBeUndefined()
    expect(env.GCM_INTERACTIVE).toBeUndefined()
    expect(env).toEqual({ PATH: '/usr/bin' })
  })
})

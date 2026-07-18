import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  ShellIcon,
  resolveShellDisplayIdentity,
  resolveTerminalTabDisplayShell
} from './shell-icons'

describe('shell display identity', () => {
  it.each([
    ['/bin/zsh', 'zsh'],
    ['bash', 'bash'],
    ['/opt/homebrew/bin/fish -l', 'fish'],
    ['nu', 'nu'],
    ['pwsh.exe', 'powershell'],
    ['C:\\Windows\\System32\\cmd.exe', 'cmd'],
    ['wsl.exe -d Ubuntu', 'wsl'],
    ['C:\\Program Files\\Git\\bin\\bash.exe', 'git-bash']
  ] as const)('recognizes %s as %s', (shell, identity) => {
    expect(resolveShellDisplayIdentity(shell)).toBe(identity)
  })

  it('renders token-based badges for light and dark theme inheritance', () => {
    const markup = renderToStaticMarkup(<ShellIcon shell="/bin/zsh" size={12} />)

    expect(markup).toContain('data-shell-identity="zsh"')
    expect(markup).toContain('border-foreground/15')
    expect(markup).toContain('bg-foreground/[0.055]')
    expect(markup).not.toContain('#000000')
    expect(markup).not.toContain('#ffffff')
  })
})

describe('resolveTerminalTabDisplayShell', () => {
  it('keeps an explicit per-tab shell override authoritative', () => {
    expect(
      resolveTerminalTabDisplayShell({
        tab: { shellOverride: '/bin/fish', title: 'bash' },
        runtimePaneTitles: { 1: 'zsh' }
      })
    ).toBe('/bin/fish')
  })

  it('uses only shell-like live titles as a display fallback', () => {
    expect(
      resolveTerminalTabDisplayShell({
        tab: { title: 'Agent task' },
        runtimePaneTitles: { 1: 'codex', 2: '/bin/zsh' }
      })
    ).toBe('/bin/zsh')
    expect(
      resolveTerminalTabDisplayShell({
        tab: { title: 'Build feature', defaultTitle: 'Terminal 1' },
        runtimePaneTitles: { 1: 'codex' }
      })
    ).toBeUndefined()
  })
})

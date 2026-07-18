import React from 'react'
import { isShellProcess } from '../../../../shared/shell-process-detection'
import type { TerminalTab } from '../../../../shared/types'
import { WINDOWS_GIT_BASH_SHELL } from '../../../../shared/windows-terminal-shell'

export type WindowsShell = 'powershell.exe' | 'cmd.exe' | 'wsl.exe' | typeof WINDOWS_GIT_BASH_SHELL

export type ShellDisplayIdentity =
  | 'powershell'
  | 'cmd'
  | 'wsl'
  | 'git-bash'
  | 'zsh'
  | 'bash'
  | 'fish'
  | 'nu'
  | 'generic'

function shellExecutableName(shell: string | null | undefined): string {
  const trimmed = shell?.trim() ?? ''
  if (!trimmed) {
    return ''
  }
  const quotedExecutable = trimmed.match(/^["']([^"']+)["']/)?.[1]
  const executable = quotedExecutable ?? trimmed
  const basename = executable.replaceAll('\\', '/').split('/').pop() ?? executable
  return basename.split(/\s+/)[0].toLowerCase()
}

export function resolveShellDisplayIdentity(
  shell: string | null | undefined
): ShellDisplayIdentity {
  const raw = shell?.trim().toLowerCase() ?? ''
  const executable = shellExecutableName(shell)
  const name = executable.replace(/\.(?:exe|cmd|bat|ps1)$/i, '')
  if (name === 'powershell' || name === 'pwsh') {
    return 'powershell'
  }
  if (name === 'cmd') {
    return 'cmd'
  }
  if (name === 'wsl' || raw.startsWith('wsl ')) {
    return 'wsl'
  }
  if (raw === WINDOWS_GIT_BASH_SHELL || executable === 'bash.exe') {
    return 'git-bash'
  }
  if (name === 'zsh') {
    return 'zsh'
  }
  if (name === 'bash') {
    return 'bash'
  }
  if (name === 'fish') {
    return 'fish'
  }
  if (name === 'nu') {
    return 'nu'
  }
  return 'generic'
}

export function resolveTerminalTabDisplayShell({
  tab,
  runtimePaneTitles
}: {
  tab: Pick<TerminalTab, 'shellOverride' | 'title' | 'defaultTitle'>
  runtimePaneTitles?: Readonly<Record<number, string>>
}): string | undefined {
  const override = tab.shellOverride?.trim()
  if (override) {
    return tab.shellOverride
  }
  const candidates = [...Object.values(runtimePaneTitles ?? {}), tab.title, tab.defaultTitle]
  return candidates.find((candidate) => {
    const trimmed = candidate?.trim() ?? ''
    return trimmed.length > 0 && isShellProcess(trimmed)
  })
}

const SHELL_IDENTITY_LABELS: Record<Exclude<ShellDisplayIdentity, 'generic'>, string> = {
  powershell: 'PS',
  cmd: 'C',
  wsl: 'W',
  'git-bash': 'G',
  zsh: 'Z',
  bash: 'B',
  fish: 'F',
  nu: 'NU'
}

function GenericPromptMark({ size }: { size: number }): React.JSX.Element {
  return (
    <svg
      width={Math.max(7, size - 4)}
      height={Math.max(7, size - 4)}
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden
    >
      <path
        d="m2.25 2.75 3.25 3-3.25 3M6.5 9h3.25"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function ShellIcon({
  shell,
  size = 14
}: {
  shell: string | null | undefined
  size?: number
}): React.JSX.Element {
  const identity = resolveShellDisplayIdentity(shell)
  return (
    <span
      data-shell-identity={identity}
      className="inline-flex shrink-0 items-center justify-center rounded-[3px] border border-foreground/15 bg-foreground/[0.055] font-mono font-semibold leading-none text-foreground/80"
      style={{ width: size, height: size }}
      aria-hidden
    >
      {identity === 'generic' ? (
        <GenericPromptMark size={size} />
      ) : (
        <span
          style={{
            fontSize: Math.max(5, Math.min(6.5, size * 0.45)),
            letterSpacing: '-0.06em'
          }}
        >
          {SHELL_IDENTITY_LABELS[identity]}
        </span>
      )}
    </span>
  )
}

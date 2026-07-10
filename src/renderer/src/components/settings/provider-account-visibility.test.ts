import { describe, expect, it } from 'vitest'
import type {
  ClaudeRateLimitAccountsState,
  CodexRateLimitAccountsState
} from '../../../../shared/types'
import { providerAccountMatchesView } from './provider-account-visibility'

const codexWslAccount = {
  id: 'codex-wsl',
  email: 'wsl@example.com',
  managedHomeRuntime: 'wsl',
  wslDistro: 'Ubuntu',
  providerAccountId: null,
  workspaceLabel: null,
  workspaceAccountId: null,
  createdAt: 1,
  updatedAt: 1,
  lastAuthenticatedAt: 1
} satisfies CodexRateLimitAccountsState['accounts'][number]

const claudeHostAccount = {
  id: 'claude-host',
  email: 'host@example.com',
  managedAuthRuntime: 'host',
  wslDistro: null,
  authMethod: 'subscription-oauth',
  organizationUuid: null,
  organizationName: null,
  createdAt: 1,
  updatedAt: 1,
  lastAuthenticatedAt: 1
} satisfies ClaudeRateLimitAccountsState['accounts'][number]

describe('providerAccountMatchesView', () => {
  it('shows WSL accounts owned by a Windows server regardless of the client platform', () => {
    expect(
      providerAccountMatchesView(
        codexWslAccount,
        { runtime: 'host' },
        {
          remoteOwner: true,
          ownerPlatform: 'win32'
        }
      )
    ).toBe(true)
  })

  it('does not expose stale WSL accounts from a non-Windows remote runtime', () => {
    expect(
      providerAccountMatchesView(
        codexWslAccount,
        { runtime: 'host' },
        {
          remoteOwner: true,
          ownerPlatform: 'linux'
        }
      )
    ).toBe(false)
    expect(
      providerAccountMatchesView(
        claudeHostAccount,
        { runtime: 'wsl' },
        {
          remoteOwner: true,
          ownerPlatform: 'linux'
        }
      )
    ).toBe(true)
  })

  it('keeps local host and WSL views isolated by runtime and distro', () => {
    const localOptions = { remoteOwner: false, ownerPlatform: 'win32' as const }

    expect(providerAccountMatchesView(codexWslAccount, { runtime: 'host' }, localOptions)).toBe(
      false
    )
    expect(
      providerAccountMatchesView(
        codexWslAccount,
        { runtime: 'wsl', wslDistro: 'Ubuntu' },
        localOptions
      )
    ).toBe(true)
    expect(
      providerAccountMatchesView(
        codexWslAccount,
        { runtime: 'wsl', wslDistro: 'Debian' },
        localOptions
      )
    ).toBe(false)
  })
})

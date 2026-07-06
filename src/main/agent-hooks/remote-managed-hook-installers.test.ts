import { beforeEach, describe, expect, it, vi } from 'vitest'

const { installCodexRemote, installClaudeRemote } = vi.hoisted(() => ({
  installCodexRemote: vi.fn(),
  installClaudeRemote: vi.fn()
}))

vi.mock('./managed-agent-hook-manifest', () => ({
  MANAGED_AGENT_HOOK_MANIFEST: [
    {
      target: { agent: 'codex', tuiAgent: 'codex', supportsRemoteManagedHooks: true },
      installRemote: installCodexRemote
    },
    {
      target: { agent: 'claude', tuiAgent: 'claude', supportsRemoteManagedHooks: true },
      installRemote: installClaudeRemote
    },
    {
      target: { agent: 'droid', tuiAgent: 'droid', supportsRemoteManagedHooks: false }
    }
  ]
}))

import {
  hasRemoteManagedHookInstallCandidate,
  installRemoteManagedAgentHooks
} from './remote-managed-hook-installers'

describe('remote managed hook installers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installCodexRemote.mockResolvedValue({
      agent: 'codex',
      state: 'installed',
      configPath: '/home/orca/.codex/config.toml',
      managedHooksPresent: true,
      detail: null
    })
    installClaudeRemote.mockResolvedValue({
      agent: 'claude',
      state: 'installed',
      configPath: '/home/orca/.claude/settings.json',
      managedHooksPresent: true,
      detail: null
    })
  })

  it('detects whether any remote-capable target has positive presence', () => {
    expect(hasRemoteManagedHookInstallCandidate({ codex: { state: 'missing' } })).toBe(false)
    expect(hasRemoteManagedHookInstallCandidate({ codex: { state: 'found' } })).toBe(true)
  })

  it('installs only remote agents with positive CLI presence', async () => {
    const results = await installRemoteManagedAgentHooks({} as never, '/home/orca', {
      codex: { state: 'found' },
      claude: { state: 'missing' }
    })

    expect(installCodexRemote).toHaveBeenCalledTimes(1)
    expect(installClaudeRemote).not.toHaveBeenCalled()
    expect(results).toEqual([
      expect.objectContaining({ agent: 'codex', state: 'installed' }),
      expect.objectContaining({
        agent: 'claude',
        state: 'skipped',
        skipReason: 'cli_not_found'
      }),
      expect.objectContaining({
        agent: 'droid',
        state: 'skipped',
        skipReason: 'remote_hook_unsupported'
      })
    ])
  })

  it('reports agents omitted from the presence map as unavailable, not missing', async () => {
    const results = await installRemoteManagedAgentHooks({} as never, '/home/orca', {
      codex: { state: 'found' }
    })

    expect(installClaudeRemote).not.toHaveBeenCalled()
    expect(results).toContainEqual(
      expect.objectContaining({
        agent: 'claude',
        state: 'skipped',
        skipReason: 'remote_presence_unavailable'
      })
    )
  })

  it('skips unknown presence without mutating remote config', async () => {
    const results = await installRemoteManagedAgentHooks({} as never, '/home/orca', {
      codex: { state: 'unknown' }
    })

    expect(installCodexRemote).not.toHaveBeenCalled()
    expect(results).toContainEqual(
      expect.objectContaining({
        agent: 'codex',
        state: 'skipped',
        skipReason: 'remote_presence_unavailable'
      })
    )
  })
})

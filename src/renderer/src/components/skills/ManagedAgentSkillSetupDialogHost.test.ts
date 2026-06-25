// @vitest-environment happy-dom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import type { ManagedAgentSkillFallback } from '../../../../shared/skills'
import type { GlobalSettings } from '../../../../shared/types'
import {
  getManagedSkillFallbackDisplayMessage,
  getManagedSkillContextCopy,
  getManagedSkillContextWorkspaceCopy
} from './managed-agent-skill-dialog-copy'
import {
  advanceManagedAgentSkillFallbackQueue,
  enqueueManagedAgentSkillFallback,
  getInstalledStateSourceKinds,
  prepareManagedAgentSkillSetupTerminal,
  replaceActiveAfterManagedAgentSkillRecheck
} from './managed-agent-skill-dialog-state'
import { ManagedAgentSkillSetupDialogHost } from './ManagedAgentSkillSetupDialogHost'

const cliPrerequisiteMocks = vi.hoisted(() => ({
  ensureOrcaCliAvailableForAgentSkillTerminal: vi.fn()
}))

const hookMocks = vi.hoisted(() => ({
  notifyInstalledAgentSkillsChanged: vi.fn(),
  useInstalledAgentSkill: vi.fn(() => ({
    installed: false,
    loading: false,
    error: null
  }))
}))

const storeMocks = vi.hoisted(() => ({
  state: {
    settings: null as ReturnType<typeof getDefaultSettings> | null,
    updateSettings: vi.fn<(updates: Partial<GlobalSettings>) => Promise<void>>(async () => {
      return undefined
    }),
    openSettingsPage: vi.fn(),
    openSettingsTarget: vi.fn()
  }
}))

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
  message: vi.fn()
}))

vi.mock('@/lib/agent-skill-cli-prerequisite', () => ({
  AGENT_SKILL_CLI_PREREQUISITE_NOTICE: 'CLI registration notice',
  ensureOrcaCliAvailableForAgentSkillTerminal:
    cliPrerequisiteMocks.ensureOrcaCliAvailableForAgentSkillTerminal,
  isOrcaCliAvailableOnPath: vi.fn()
}))

vi.mock('@/hooks/useInstalledAgentSkills', () => ({
  notifyInstalledAgentSkillsChanged: hookMocks.notifyInstalledAgentSkillsChanged,
  useInstalledAgentSkill: hookMocks.useInstalledAgentSkill
}))

vi.mock('@/store', () => {
  const useAppStore = Object.assign(
    (selector: (state: typeof storeMocks.state) => unknown) => selector(storeMocks.state),
    { getState: () => storeMocks.state }
  )
  return { useAppStore }
})

vi.mock('sonner', () => ({
  toast: {
    error: toastMocks.error,
    message: toastMocks.message
  }
}))

function fallback(
  patch: Partial<ManagedAgentSkillFallback> & Pick<ManagedAgentSkillFallback, 'context'>
): ManagedAgentSkillFallback {
  const skillName = patch.skillName ?? 'orchestration'
  const runtime = patch.runtime ?? 'host'
  const scope = patch.scope ?? 'global'
  return {
    status: 'fallback',
    skillName,
    context: patch.context,
    runtime,
    scope,
    reason: patch.reason ?? 'background-update-disabled',
    uiKey: patch.uiKey ?? [runtime, '', skillName, patch.context].join(':'),
    message: patch.message ?? 'Fallback message.',
    manualCommand: patch.manualCommand,
    request: patch.request ?? {
      skillName,
      context: patch.context,
      ...(runtime === 'remote' ? { remoteRuntime: true } : { discoveryTarget: { runtime: 'host' } })
    }
  }
}

beforeEach(() => {
  cliPrerequisiteMocks.ensureOrcaCliAvailableForAgentSkillTerminal.mockReset()
  hookMocks.notifyInstalledAgentSkillsChanged.mockReset()
  hookMocks.useInstalledAgentSkill.mockClear()
  storeMocks.state.settings = getDefaultSettings('/tmp')
  storeMocks.state.updateSettings.mockReset()
  storeMocks.state.updateSettings.mockImplementation(async (updates) => {
    storeMocks.state.settings = storeMocks.state.settings
      ? { ...storeMocks.state.settings, ...updates }
      : null
  })
  storeMocks.state.openSettingsPage.mockReset()
  storeMocks.state.openSettingsTarget.mockReset()
  toastMocks.error.mockReset()
  toastMocks.message.mockReset()
  document.body.innerHTML = ''
})

describe('ManagedAgentSkillSetupDialogHost copy', () => {
  it('uses neutral orchestration context copy when no workspace is available', () => {
    expect(getManagedSkillContextCopy('agent-orchestration', 'Update')).toBe(
      'Orca Orchestration was used. Update the orchestration skill to enable agents to coordinate reliably.'
    )
  })

  it('names the Linear worktree context', () => {
    expect(getManagedSkillContextCopy('linear-worktree', 'Install')).toBe(
      'A worktree was started from a Linear task. Install the Linear agent skill to enable agents to read and update Linear issues.'
    )
  })

  it('supports review copy for fallback cases without a runnable command', () => {
    expect(getManagedSkillContextCopy('agent-orchestration', 'Review')).toBe(
      'Orca Orchestration was used. Review the orchestration skill to enable agents to coordinate reliably.'
    )
  })

  it('splits workspace-aware context copy so the workspace can expose its full path', () => {
    expect(getManagedSkillContextWorkspaceCopy('agent-computer-use', 'Install')).toEqual({
      beforeWorkspace: 'Computer Use was used in ',
      afterWorkspace: '. Install the Computer Use skill to enable agents to control apps reliably.'
    })
  })

  it('localizes fallback reason copy in the renderer', () => {
    expect(getManagedSkillFallbackDisplayMessage('remote-runtime')).toBe(
      'This skill is on a remote runtime, so Orca needs you to update it there.'
    )
  })
})

describe('ManagedAgentSkillSetupDialogHost queue state', () => {
  it('prepares the Orca CLI before opening the setup terminal', async () => {
    cliPrerequisiteMocks.ensureOrcaCliAvailableForAgentSkillTerminal.mockResolvedValue(null)

    await prepareManagedAgentSkillSetupTerminal()

    expect(cliPrerequisiteMocks.ensureOrcaCliAvailableForAgentSkillTerminal).toHaveBeenCalledOnce()
  })

  it('returns stable source-kind filters for installed-state refreshes', () => {
    expect(getInstalledStateSourceKinds('global')).toBe(getInstalledStateSourceKinds('global'))
    expect(getInstalledStateSourceKinds('project')).toBe(getInstalledStateSourceKinds('project'))
    expect(getInstalledStateSourceKinds('bundled')).toBe(getInstalledStateSourceKinds('bundled'))
    expect(getInstalledStateSourceKinds('plugin')).toBe(getInstalledStateSourceKinds('plugin'))
  })

  it('shows the first fallback immediately and queues later fallbacks FIFO', () => {
    const first = fallback({
      context: 'agent-orchestration',
      uiKey: 'host::orchestration:agent-orchestration'
    })
    const second = fallback({
      skillName: 'computer-use',
      context: 'agent-computer-use',
      uiKey: 'host::computer-use:agent-computer-use'
    })

    const withFirst = enqueueManagedAgentSkillFallback({ active: null, queue: [] }, first)
    const withSecond = enqueueManagedAgentSkillFallback(withFirst, second)

    expect(withSecond).toEqual({ active: first, queue: [second] })
    expect(advanceManagedAgentSkillFallbackQueue(withSecond)).toEqual({
      active: second,
      queue: []
    })
  })

  it('clears the active fallback when the queue is empty', () => {
    const event = fallback({
      context: 'agent-orchestration',
      uiKey: 'host::orchestration:agent-orchestration'
    })

    expect(advanceManagedAgentSkillFallbackQueue({ active: event, queue: [] })).toEqual({
      active: null,
      queue: []
    })
  })

  it('does not replace the active modal with a cooldown re-check fallback', () => {
    const active = fallback({
      context: 'agent-orchestration',
      uiKey: 'host::orchestration:agent-orchestration',
      manualCommand: {
        kind: 'install',
        command: 'npx skills install orchestration',
        runtime: 'host',
        scope: 'global'
      }
    })
    const deadEndFallback = fallback({
      context: 'agent-orchestration',
      reason: 'cooldown',
      uiKey: 'host::orchestration:agent-orchestration'
    })

    expect(
      replaceActiveAfterManagedAgentSkillRecheck({ active, queue: [] }, deadEndFallback)
    ).toEqual({
      active: null,
      queue: []
    })
  })

  it('keeps manual-review safety fallbacks visible after re-check', () => {
    const active = fallback({
      context: 'agent-orchestration',
      uiKey: 'host::orchestration:agent-orchestration',
      manualCommand: {
        kind: 'update',
        command: 'npx skills update orchestration',
        runtime: 'host',
        scope: 'global'
      }
    })
    const reviewFallback = fallback({
      context: 'agent-orchestration',
      reason: 'lockfile-malformed',
      uiKey: 'host::orchestration:agent-orchestration'
    })

    expect(
      replaceActiveAfterManagedAgentSkillRecheck({ active, queue: [] }, reviewFallback)
    ).toEqual({
      active: reviewFallback,
      queue: []
    })
  })
})

describe('ManagedAgentSkillSetupDialogHost rendering', () => {
  async function renderHost(): Promise<{
    root: Root
    emitFallback: (event: ManagedAgentSkillFallback) => void
  }> {
    let fallbackListener: ((event: ManagedAgentSkillFallback) => void) | null = null
    window.api = {
      skills: {
        onManagedFallback: vi.fn((listener) => {
          fallbackListener = listener
          return vi.fn()
        }),
        onManagedUpdated: vi.fn(() => vi.fn())
      }
    } as unknown as typeof window.api
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(React.createElement(ManagedAgentSkillSetupDialogHost))
    })
    return {
      root,
      emitFallback: (event) => {
        if (!fallbackListener) {
          throw new Error('fallback listener was not registered')
        }
        fallbackListener(event)
      }
    }
  }

  it('turns off managed skill setup prompts when Don’t show again is clicked', async () => {
    const { root, emitFallback } = await renderHost()
    await act(async () => {
      emitFallback(fallback({ context: 'agent-orchestration' }))
    })

    const button = Array.from(document.querySelectorAll('button')).find(
      (entry) => entry.textContent === "Don't show again"
    )
    if (!button) {
      throw new Error("Don't show again button was not rendered")
    }

    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(storeMocks.state.updateSettings).toHaveBeenCalledWith({
      managedAgentSkillSetupPromptsEnabled: false
    })
    expect(toastMocks.message).toHaveBeenCalledWith(
      'Agent skill setup prompts are off',
      expect.objectContaining({
        description: 'Turn them back on in Settings → Agents.',
        action: expect.objectContaining({ label: 'Open Settings' })
      })
    )
    const toastOptions = toastMocks.message.mock.calls[0]?.[1]
    toastOptions?.action?.onClick()
    expect(storeMocks.state.openSettingsTarget).toHaveBeenCalledWith({
      pane: 'agents',
      repoId: null
    })
    expect(storeMocks.state.openSettingsPage).toHaveBeenCalledOnce()
    root.unmount()
  })

  it('keeps the modal open when Don’t show again cannot persist', async () => {
    storeMocks.state.updateSettings.mockResolvedValue(undefined)
    const { root, emitFallback } = await renderHost()
    await act(async () => {
      emitFallback(fallback({ context: 'agent-orchestration' }))
    })

    const button = Array.from(document.querySelectorAll('button')).find(
      (entry) => entry.textContent === "Don't show again"
    )
    if (!button) {
      throw new Error("Don't show again button was not rendered")
    }

    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(toastMocks.error).toHaveBeenCalledWith(
      "Couldn't turn off agent skill setup prompts",
      expect.objectContaining({
        description: 'Try again from Settings → Agents.',
        action: expect.objectContaining({ label: 'Open Settings' })
      })
    )
    expect(toastMocks.message).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Agent skill setup needed')
    root.unmount()
  })

  it('does not show managed skill setup prompts when the setting is off', async () => {
    storeMocks.state.settings = {
      ...getDefaultSettings('/tmp'),
      managedAgentSkillSetupPromptsEnabled: false
    }
    const { root, emitFallback } = await renderHost()

    await act(async () => {
      emitFallback(fallback({ context: 'agent-orchestration' }))
    })

    expect(document.body.textContent).not.toContain('Agent skill setup needed')
    root.unmount()
  })
})

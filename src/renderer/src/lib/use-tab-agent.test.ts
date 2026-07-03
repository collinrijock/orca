// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import type { AgentStatusEntry } from '../../../shared/agent-status-types'
import { makePaneKey } from '../../../shared/stable-pane-id'
import type { TerminalLayoutSnapshot, TerminalTab, TuiAgent } from '../../../shared/types'
import { resolveTabAgentFromSignals, useTabAgent } from './use-tab-agent'

const initialAppState = useAppStore.getInitialState()
const LEAF_ID = '11111111-1111-4111-8111-111111111111'
const SECOND_LEAF_ID = '22222222-2222-4222-8222-222222222222'
let latestHookAgent: TuiAgent | null | undefined
const hookRoots: Root[] = []

function HookProbe({ tab }: { tab: TerminalTab }): null {
  latestHookAgent = useTabAgent(tab)
  return null
}

async function renderHookProbe(tab: TerminalTab): Promise<Root> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  hookRoots.push(root)
  await act(async () => {
    root.render(createElement(HookProbe, { tab }))
  })
  await flushHookEffects()
  return root
}

async function rerenderHookProbe(root: Root, tab: TerminalTab): Promise<void> {
  await act(async () => {
    root.render(createElement(HookProbe, { tab }))
  })
  await flushHookEffects()
}

async function flushHookEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function agentStatus(paneKey: string, state: AgentStatusEntry['state']): AgentStatusEntry {
  return {
    state,
    prompt: '',
    updatedAt: 1,
    stateStartedAt: 1,
    agentType: 'codex',
    paneKey,
    stateHistory: []
  }
}

function completedAgentStatus(paneKey: string): AgentStatusEntry {
  return agentStatus(paneKey, 'done')
}

function workingAgentStatus(paneKey: string): AgentStatusEntry {
  return agentStatus(paneKey, 'working')
}

function twoPaneLayout(): TerminalLayoutSnapshot {
  return {
    root: null,
    activeLeafId: LEAF_ID,
    expandedLeafId: null,
    ptyIdsByLeafId: {
      [LEAF_ID]: 'pty-focus',
      [SECOND_LEAF_ID]: 'pty-sibling'
    }
  }
}

describe('resolveTabAgentFromSignals', () => {
  it('keeps launch intent during the pre-start shell window', () => {
    expect(
      resolveTabAgentFromSignals({
        hasObservedAgentSignal: false,
        isRemote: false,
        title: 'Terminal 1',
        hookAgent: null,
        hasCompletedHook: false,
        launchAgent: 'claude'
      })
    ).toBe('claude')
  })

  it('trusts live hook identity at a shell title until the hook row is dropped', () => {
    expect(
      resolveTabAgentFromSignals({
        hasObservedAgentSignal: true,
        isRemote: false,
        title: 'zsh',
        hookAgent: 'claude',
        hasCompletedHook: false,
        launchAgent: 'claude'
      })
    ).toBe('claude')
  })

  it('maps OpenClaude titles to the distinct OpenClaude tab icon', () => {
    expect(
      resolveTabAgentFromSignals({
        hasObservedAgentSignal: false,
        isRemote: false,
        title: '⠋ OpenClaude',
        hookAgent: null,
        hasCompletedHook: false,
        launchAgent: undefined
      })
    ).toBe('openclaude')
  })

  it('keeps title fallback for real Gemini, MiMo, and Pi titles', () => {
    expect(
      resolveTabAgentFromSignals({
        hasObservedAgentSignal: false,
        isRemote: false,
        title: '✦ Gemini CLI',
        hookAgent: null,
        hasCompletedHook: false,
        launchAgent: undefined
      })
    ).toBe('gemini')

    expect(
      resolveTabAgentFromSignals({
        hasObservedAgentSignal: false,
        isRemote: false,
        title: 'MiMo Code',
        hookAgent: null,
        hasCompletedHook: false,
        launchAgent: undefined
      })
    ).toBe('mimo-code')

    expect(
      resolveTabAgentFromSignals({
        hasObservedAgentSignal: false,
        isRemote: false,
        title: 'π - my-project',
        hookAgent: null,
        hasCompletedHook: false,
        launchAgent: undefined
      })
    ).toBe('pi')
  })

  it("uses completed OpenClaude hook identity over Claude's generic task-title heuristic", () => {
    expect(
      resolveTabAgentFromSignals({
        hasObservedAgentSignal: true,
        isRemote: false,
        title: '✳ Say hi',
        hookAgent: null,
        hasCompletedHook: true,
        completedHookAgent: 'openclaude',
        launchAgent: 'openclaude'
      })
    ).toBe('openclaude')
  })

  it('keeps launch identity over title identity while hooks have not arrived', () => {
    expect(
      resolveTabAgentFromSignals({
        hasObservedAgentSignal: false,
        isRemote: false,
        title: '✳ Say hi',
        hookAgent: null,
        hasCompletedHook: false,
        launchAgent: 'openclaude'
      })
    ).toBe('openclaude')
  })

  it("keeps Codex launch intent over Claude's generic spinner title fallback", () => {
    expect(
      resolveTabAgentFromSignals({
        hasObservedAgentSignal: false,
        isRemote: false,
        title: '⠸ codex-quarter-flash-202606191419',
        hookAgent: null,
        hasCompletedHook: false,
        launchAgent: 'codex'
      })
    ).toBe('codex')
  })

  it('does not infer Claude identity from a generic spinner title without context', () => {
    expect(
      resolveTabAgentFromSignals({
        hasObservedAgentSignal: false,
        isRemote: false,
        title: '⠸ investigating startup',
        hookAgent: null,
        hasCompletedHook: false,
        launchAgent: undefined
      })
    ).toBeNull()
  })

  it('does not infer Claude identity from generic dot or star status titles', () => {
    for (const title of ['. investigating startup', '* investigating startup', '✳ investigating']) {
      expect(
        resolveTabAgentFromSignals({
          hasObservedAgentSignal: false,
          isRemote: false,
          title,
          hookAgent: null,
          hasCompletedHook: false,
          launchAgent: undefined
        })
      ).toBeNull()
    }
  })

  it('keeps launch identity over explicit title identity until stronger signals arrive', () => {
    expect(
      resolveTabAgentFromSignals({
        hasObservedAgentSignal: false,
        isRemote: false,
        title: '⠸ Claude Code',
        hookAgent: null,
        hasCompletedHook: false,
        launchAgent: 'codex'
      })
    ).toBe('codex')
  })

  it("uses Codex hook identity over Claude's generic task-title heuristic", () => {
    expect(
      resolveTabAgentFromSignals({
        hasObservedAgentSignal: true,
        isRemote: false,
        title: '✳ improve-pr-actions-customization',
        hookAgent: 'codex',
        hasCompletedHook: false,
        launchAgent: 'codex'
      })
    ).toBe('codex')
  })

  it('keeps launch identity over explicit Claude Code titles without hook evidence', () => {
    expect(
      resolveTabAgentFromSignals({
        hasObservedAgentSignal: false,
        isRemote: false,
        title: '✳ Claude Code',
        hookAgent: null,
        hasCompletedHook: false,
        launchAgent: 'openclaude'
      })
    ).toBe('openclaude')
  })

  it('lets an explicit title override stale launch identity after the pane shows newer activity', () => {
    expect(
      resolveTabAgentFromSignals({
        hasObservedAgentSignal: true,
        isRemote: false,
        title: '✳ Claude Code',
        hookAgent: null,
        hasCompletedHook: false,
        launchAgent: 'codex'
      })
    ).toBe('claude')
  })

  it('does not let an explicit title override launch identity before any activity is observed', () => {
    expect(
      resolveTabAgentFromSignals({
        hasObservedAgentSignal: false,
        isRemote: false,
        title: '✳ Claude Code',
        hookAgent: null,
        hasCompletedHook: false,
        launchAgent: 'codex'
      })
    ).toBe('codex')
  })

  it('prefers explicit hook identity over a conflicting title mention', () => {
    expect(
      resolveTabAgentFromSignals({
        hasObservedAgentSignal: true,
        isRemote: false,
        title: '✳ Gemini CLI',
        hookAgent: 'claude',
        hasCompletedHook: false,
        launchAgent: 'claude'
      })
    ).toBe('claude')
  })

  it('prefers explicit hook identity over ordinary non-Claude title identity', () => {
    expect(
      resolveTabAgentFromSignals({
        hasObservedAgentSignal: true,
        isRemote: false,
        title: '✦ Gemini CLI',
        hookAgent: 'claude',
        hasCompletedHook: false,
        launchAgent: 'gemini'
      })
    ).toBe('claude')
  })

  it('lets focused-pane hook identity override launch metadata in split tabs', () => {
    expect(
      resolveTabAgentFromSignals({
        hasObservedAgentSignal: true,
        isRemote: false,
        title: 'Terminal 1',
        hookAgent: 'claude',
        siblingHookAgent: 'gemini',
        hasCompletedHook: false,
        launchAgent: 'codex'
      })
    ).toBe('claude')
  })

  it('keeps unresolved launch metadata ahead of sibling-pane hook fallback', () => {
    expect(
      resolveTabAgentFromSignals({
        hasObservedAgentSignal: false,
        isRemote: false,
        title: 'Terminal 1',
        hookAgent: null,
        siblingHookAgent: 'claude',
        hasCompletedHook: false,
        launchAgent: 'codex'
      })
    ).toBe('codex')
  })

  it('uses sibling-pane hook fallback when no launch metadata exists', () => {
    expect(
      resolveTabAgentFromSignals({
        hasObservedAgentSignal: false,
        isRemote: false,
        title: 'Terminal 1',
        hookAgent: null,
        siblingHookAgent: 'claude',
        hasCompletedHook: false,
        launchAgent: undefined
      })
    ).toBe('claude')
  })

  it('keeps launch identity over Claude-owned task text without hook evidence', () => {
    expect(
      resolveTabAgentFromSignals({
        hasObservedAgentSignal: false,
        isRemote: false,
        title: '✳ Gemini CLI',
        hookAgent: null,
        hasCompletedHook: false,
        launchAgent: 'gemini'
      })
    ).toBe('gemini')
  })

  it('keeps launch identity over Claude-owned punctuation-prefixed task text', () => {
    expect(
      resolveTabAgentFromSignals({
        hasObservedAgentSignal: false,
        isRemote: false,
        title: '. Compare Opencode Vs Orca',
        hookAgent: null,
        hasCompletedHook: false,
        launchAgent: 'opencode'
      })
    ).toBe('opencode')

    expect(
      resolveTabAgentFromSignals({
        hasObservedAgentSignal: false,
        isRemote: false,
        title: '* Review Codex behavior',
        hookAgent: null,
        hasCompletedHook: false,
        launchAgent: 'codex'
      })
    ).toBe('codex')
  })

  it('treats Claude-prefixed title text as Claude only when it names Claude', () => {
    expect(
      resolveTabAgentFromSignals({
        hasObservedAgentSignal: false,
        isRemote: false,
        title: '✳ Claude Code',
        hookAgent: null,
        hasCompletedHook: false,
        launchAgent: undefined
      })
    ).toBe('claude')

    expect(
      resolveTabAgentFromSignals({
        hasObservedAgentSignal: false,
        isRemote: false,
        title: '. Claude Code compare Opencode',
        hookAgent: null,
        hasCompletedHook: false,
        launchAgent: undefined
      })
    ).toBe('claude')
  })

  it('keeps launch identity at a shell title until hook evidence proves exit', () => {
    expect(
      resolveTabAgentFromSignals({
        hasObservedAgentSignal: true,
        isRemote: false,
        title: 'zsh',
        hookAgent: null,
        hasCompletedHook: false,
        launchAgent: 'codex'
      })
    ).toBe('codex')
  })

  it('keeps hook identity for remote panes', () => {
    expect(
      resolveTabAgentFromSignals({
        hasObservedAgentSignal: true,
        isRemote: true,
        title: 'Terminal 1',
        hookAgent: 'codex',
        hasCompletedHook: false,
        launchAgent: 'claude'
      })
    ).toBe('codex')
  })

  it('keeps completed remote hook identity after the terminal title returns to a shell', () => {
    expect(
      resolveTabAgentFromSignals({
        hasObservedAgentSignal: true,
        isRemote: true,
        title: 'zsh',
        hookAgent: null,
        hasCompletedHook: true,
        completedHookAgent: 'codex',
        launchAgent: 'codex'
      })
    ).toBe('codex')
  })

  it('clears local launch identity once a completed hook and shell title prove exit', () => {
    // Why: without foreground probing, a completed hook plus the title back at
    // a shell is the process-gone evidence — the same signals that clear the
    // sidebar row — so stale launch identity must not keep painting the tab.
    expect(
      resolveTabAgentFromSignals({
        hasObservedAgentSignal: true,
        isRemote: false,
        title: 'zsh',
        hookAgent: null,
        hasCompletedHook: true,
        completedHookAgent: 'claude',
        launchAgent: 'claude'
      })
    ).toBeNull()
  })
})

describe('useTabAgent', () => {
  const originalApi = window.api
  const getForegroundProcess = vi.fn()
  const clearTabLaunchAgent = vi.fn()
  const baseTab: TerminalTab = {
    id: 'tab-1',
    ptyId: 'pty-1',
    worktreeId: 'wt-1',
    title: 'Terminal 1',
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 1,
    launchAgent: 'codex'
  }

  beforeEach(() => {
    latestHookAgent = undefined
    getForegroundProcess.mockReset()
    clearTabLaunchAgent.mockReset()
    useAppStore.setState(initialAppState, true)
    useAppStore.setState({
      ptyIdsByTabId: { 'tab-1': ['pty-1'] },
      agentStatusByPaneKey: {},
      terminalLayoutsByTabId: {},
      clearTabLaunchAgent
    })
    window.api = {
      ...originalApi,
      pty: {
        ...originalApi?.pty,
        getForegroundProcess
      }
    } as typeof window.api
  })

  afterEach(() => {
    hookRoots.splice(0).forEach((root) => {
      act(() => root.unmount())
    })
    document.body.replaceChildren()
    useAppStore.setState(initialAppState, true)
    window.api = originalApi
  })

  it('never probes the foreground process', async () => {
    const paneKey = makePaneKey('tab-1', LEAF_ID)
    useAppStore.setState({
      terminalLayoutsByTabId: {
        'tab-1': {
          root: { type: 'leaf', leafId: LEAF_ID },
          activeLeafId: LEAF_ID,
          expandedLeafId: null,
          ptyIdsByLeafId: { [LEAF_ID]: 'pty-1' }
        }
      },
      agentStatusByPaneKey: {
        [paneKey]: workingAgentStatus(paneKey)
      }
    })

    const root = await renderHookProbe(baseTab)
    await rerenderHookProbe(root, { ...baseTab, title: '✳ Codex' })
    await rerenderHookProbe(root, { ...baseTab, title: 'zsh' })

    expect(latestHookAgent).toBe('codex')
    expect(getForegroundProcess).not.toHaveBeenCalled()
  })

  it('does not clear launch identity while the live hook row persists at a shell title', async () => {
    const paneKey = makePaneKey('tab-1', LEAF_ID)
    useAppStore.setState({
      terminalLayoutsByTabId: {
        'tab-1': {
          root: { type: 'leaf', leafId: LEAF_ID },
          activeLeafId: LEAF_ID,
          expandedLeafId: null,
          ptyIdsByLeafId: { [LEAF_ID]: 'pty-1' }
        }
      },
      agentStatusByPaneKey: {
        [paneKey]: workingAgentStatus(paneKey)
      }
    })

    await renderHookProbe({ ...baseTab, title: 'zsh' })

    expect(latestHookAgent).toBe('codex')
    expect(clearTabLaunchAgent).not.toHaveBeenCalled()
  })

  it('clears launch identity when a previously observed hook row drops at a shell title', async () => {
    const paneKey = makePaneKey('tab-1', LEAF_ID)
    useAppStore.setState({
      terminalLayoutsByTabId: {
        'tab-1': {
          root: { type: 'leaf', leafId: LEAF_ID },
          activeLeafId: LEAF_ID,
          expandedLeafId: null,
          ptyIdsByLeafId: { [LEAF_ID]: 'pty-1' }
        }
      },
      agentStatusByPaneKey: {
        [paneKey]: workingAgentStatus(paneKey)
      }
    })

    const root = await renderHookProbe(baseTab)

    expect(latestHookAgent).toBe('codex')
    expect(clearTabLaunchAgent).not.toHaveBeenCalled()

    // Why: crash/kill exits never fire a completed hook — the OSC 133
    // command-finished machinery drops the live entry and the title returns
    // to a shell. That already-computed evidence must clear launch intent.
    await act(async () => {
      useAppStore.setState({ agentStatusByPaneKey: {} })
    })
    await rerenderHookProbe(root, { ...baseTab, title: 'zsh' })

    expect(clearTabLaunchAgent).toHaveBeenCalledWith('tab-1')
  })

  it('uses completed local hook status as launch lifecycle evidence after remount', async () => {
    const paneKey = makePaneKey('tab-1', LEAF_ID)
    useAppStore.setState({
      agentStatusByPaneKey: {
        [paneKey]: completedAgentStatus(paneKey)
      }
    })

    await renderHookProbe({ ...baseTab, title: 'zsh' })

    expect(clearTabLaunchAgent).toHaveBeenCalledWith('tab-1')
    expect(latestHookAgent).toBeNull()
    expect(getForegroundProcess).not.toHaveBeenCalled()
  })

  it('treats paired runtime PTYs as remote-like for completed hook fallback', async () => {
    const paneKey = makePaneKey('tab-1', LEAF_ID)
    useAppStore.setState({
      ptyIdsByTabId: { 'tab-1': ['remote:web-env-1@@terminal-1'] },
      agentStatusByPaneKey: {
        [paneKey]: completedAgentStatus(paneKey)
      }
    })

    await renderHookProbe({
      ...baseTab,
      ptyId: 'remote:web-env-1@@terminal-1',
      title: 'zsh',
      launchAgent: undefined
    })

    expect(latestHookAgent).toBe('codex')
    expect(getForegroundProcess).not.toHaveBeenCalled()
  })

  it('does not let a split-tab fallback PTY suppress missing-layout hook identity', async () => {
    const paneKey = makePaneKey('tab-1', LEAF_ID)
    useAppStore.setState({
      ptyIdsByTabId: { 'tab-1': ['pty-shell', 'pty-agent'] },
      terminalLayoutsByTabId: {},
      agentStatusByPaneKey: {
        [paneKey]: workingAgentStatus(paneKey)
      }
    })

    await renderHookProbe({
      ...baseTab,
      title: 'zsh',
      launchAgent: 'claude'
    })

    expect(latestHookAgent).toBe('codex')
    expect(getForegroundProcess).not.toHaveBeenCalled()
  })

  it('does not use completed sibling hook status as focused launch lifecycle evidence', async () => {
    const siblingPaneKey = makePaneKey('tab-1', SECOND_LEAF_ID)
    useAppStore.setState({
      ptyIdsByTabId: { 'tab-1': ['pty-focus', 'pty-sibling'] },
      terminalLayoutsByTabId: { 'tab-1': twoPaneLayout() },
      agentStatusByPaneKey: {
        [siblingPaneKey]: completedAgentStatus(siblingPaneKey)
      }
    })

    await renderHookProbe({
      ...baseTab,
      ptyId: 'pty-focus',
      title: 'zsh',
      launchAgent: 'claude'
    })

    expect(latestHookAgent).toBe('claude')
    expect(clearTabLaunchAgent).not.toHaveBeenCalled()
    expect(getForegroundProcess).not.toHaveBeenCalled()
  })
})

import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import { isShellProcess } from '../../../shared/agent-detection'
import { worktreeUsesRemoteConnection } from '@/store/slices/terminals'
import { parseRemoteRuntimePtyId } from '@/runtime/runtime-terminal-stream'
import {
  resolveFocusedCompletedTabAgent,
  resolveFocusedTabAgent,
  resolveSiblingCompletedTabAgent,
  resolveSiblingTabAgent
} from './tab-agent'
import { resolveExplicitTerminalTitleAgentType } from '../../../shared/terminal-title-agent-type'
import type { TerminalTab, TuiAgent } from '../../../shared/types'

export { resolveExplicitTerminalTitleAgentType as resolveTabAgentFromTitle } from '../../../shared/terminal-title-agent-type'

export function resolveTabAgentFromSignals(args: {
  hasObservedAgentSignal: boolean
  isRemote: boolean
  title: string
  hookAgent: TuiAgent | null
  siblingHookAgent?: TuiAgent | null
  hasCompletedHook: boolean
  completedHookAgent?: TuiAgent | null
  launchAgent?: TuiAgent
}): TuiAgent | null {
  const launchAgent = args.launchAgent ?? null
  const explicitTitleAgent = resolveExplicitTerminalTitleAgentType(args.title)
  // Why: when a pane is reused for a different agent, its launchAgent goes stale.
  // A live title that explicitly names a *different* agent, once the pane has
  // shown any activity, overrides that stale launch identity so the tab icon
  // tracks what is actually running (codex launch reused for claude, etc.).
  const titleOverridesLaunch =
    launchAgent !== null &&
    explicitTitleAgent !== null &&
    explicitTitleAgent !== launchAgent &&
    args.hasObservedAgentSignal
  const titleAgent = titleOverridesLaunch
    ? explicitTitleAgent
    : launchAgent
      ? null
      : explicitTitleAgent
  const titleLooksShell = isShellProcess(args.title)
  // Why: remote pane titles can lag their runtime, so keep the last completed
  // hook identity instead of flashing unknown when the title reads as a shell.
  const completedHookAgent =
    !args.isRemote && titleLooksShell && args.hasCompletedHook ? null : args.completedHookAgent
  const focusedHookAgent = args.hookAgent ?? null
  const fallbackHookAgent = args.siblingHookAgent ?? completedHookAgent ?? null
  // Why: a completed hook with the title back at a shell is this pipeline's
  // process-gone evidence — the same signals that clear the sidebar row.
  const completedHookAtShellTitle = titleLooksShell && args.hasCompletedHook
  const activeLaunchAgent = completedHookAtShellTitle ? null : launchAgent
  // Why: titleAgent ranks ahead of launch/fallback hooks because, once the
  // pane has shown activity, a live explicit title is the freshest identity
  // signal — it beats a launchAgent gone stale through pane reuse. Before any
  // activity, titleAgent is null while launchAgent exists, so launch bootstrap
  // still wins the startup window.
  return focusedHookAgent ?? titleAgent ?? activeLaunchAgent ?? fallbackHookAgent
}

/**
 * Resolve which coding-harness agent a terminal tab is running, for its tab-bar
 * icon. Identity flows through the same already-computed state as the sidebar
 * agent rows — no foreground probing. Layered signals, most-authoritative
 * first:
 *
 * 1. Hook status — provider identity from native integrations; the live entry
 *    for the pane, dropped by the same OSC 133 command-finished machinery that
 *    clears the sidebar row when the process exits.
 * 2. launchAgent — what Orca launched here; instant bootstrap before hooks
 *    arrive, cleared once hook/title evidence shows the launched agent exited.
 * 3. Title — legacy/unknown-session fallback, and the live override when a pane
 *    is reused: once the pane has shown activity, a title that explicitly names
 *    a different agent than launchAgent wins over that stale launch identity.
 *    Otherwise it is ignored while launchAgent exists, and generic spinner-only
 *    titles never identify an agent.
 */
export function useTabAgent(tab: TerminalTab): TuiAgent | null {
  const focusedHookAgent = useAppStore((s) =>
    resolveFocusedTabAgent(s.agentStatusByPaneKey, s.terminalLayoutsByTabId[tab.id], tab.id)
  )
  const siblingHookAgent = useAppStore((s) =>
    resolveSiblingTabAgent(s.agentStatusByPaneKey, s.terminalLayoutsByTabId[tab.id], tab.id)
  )
  const focusedCompletedHookAgent = useAppStore((s) =>
    resolveFocusedCompletedTabAgent(
      s.agentStatusByPaneKey,
      s.terminalLayoutsByTabId[tab.id],
      tab.id
    )
  )
  const siblingCompletedHookAgent = useAppStore((s) =>
    resolveSiblingCompletedTabAgent(
      s.agentStatusByPaneKey,
      s.terminalLayoutsByTabId[tab.id],
      tab.id
    )
  )
  const completedHookAgent = focusedCompletedHookAgent ?? siblingCompletedHookAgent
  const hasCompletedHook = focusedCompletedHookAgent !== null
  const clearTabLaunchAgent = useAppStore((s) => s.clearTabLaunchAgent)

  // The focused pane's PTY (single-pane tabs have exactly one leaf). Only used
  // to reset per-process-generation signals when the pane is respawned.
  const ptyId = useAppStore((s) => {
    const layout = s.terminalLayoutsByTabId[tab.id]
    const activeLeafId = layout?.activeLeafId
    const leafPty = activeLeafId ? layout?.ptyIdsByLeafId?.[activeLeafId] : undefined
    if (leafPty) {
      return leafPty
    }
    const ptyIds = s.ptyIdsByTabId[tab.id] ?? []
    return ptyIds.length === 1 ? ptyIds[0]! : null
  })
  const hasRemoteRuntimePty = useAppStore((s) => {
    const layout = s.terminalLayoutsByTabId[tab.id]
    const ptyIds = new Set(s.ptyIdsByTabId[tab.id] ?? [])
    for (const ptyId of Object.values(layout?.ptyIdsByLeafId ?? {})) {
      ptyIds.add(ptyId)
    }
    return [...ptyIds].some((ptyId) => parseRemoteRuntimePtyId(ptyId) !== null)
  })
  const isRemoteWorktree = useAppStore((s) => worktreeUsesRemoteConnection(s, tab.worktreeId))
  const isRemoteLike = isRemoteWorktree || hasRemoteRuntimePty

  const [hasObservedAgentSignal, setHasObservedAgentSignal] = useState(false)
  const hasObservedAgentSignalRef = useRef(false)

  useEffect(() => {
    setHasObservedAgentSignal(false)
    hasObservedAgentSignalRef.current = false
  }, [ptyId, isRemoteLike])

  useEffect(() => {
    const fallbackAgentSignal =
      !tab.launchAgent && (resolveExplicitTerminalTitleAgentType(tab.title) || siblingHookAgent)
    if (focusedHookAgent || hasCompletedHook || fallbackAgentSignal) {
      hasObservedAgentSignalRef.current = true
      setHasObservedAgentSignal(true)
    }
  }, [focusedHookAgent, hasCompletedHook, siblingHookAgent, tab.launchAgent, tab.title])

  useEffect(() => {
    if (!tab.launchAgent) {
      return
    }
    const titleLooksShell = isShellProcess(tab.title)
    // Why: launched-agent exit evidence without probing — either the hook
    // completed, or the pane's live hook row was dropped by command-finished
    // after the pane had shown agent activity, while the title reads as a
    // shell again. Crash/kill paths land in the second disjunct because the
    // OSC 133 drop removes the live entry without a completed hook.
    const launchedAgentExited =
      titleLooksShell && (hasCompletedHook || (hasObservedAgentSignal && !focusedHookAgent))
    if (launchedAgentExited) {
      clearTabLaunchAgent(tab.id)
    }
  }, [
    clearTabLaunchAgent,
    focusedHookAgent,
    hasCompletedHook,
    hasObservedAgentSignal,
    tab.id,
    tab.launchAgent,
    tab.title
  ])

  return resolveTabAgentFromSignals({
    hasObservedAgentSignal,
    isRemote: isRemoteLike,
    title: tab.title,
    hookAgent: focusedHookAgent,
    siblingHookAgent,
    hasCompletedHook,
    completedHookAgent,
    launchAgent: tab.launchAgent
  })
}

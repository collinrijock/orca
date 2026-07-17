import { useCallback, useEffect, useRef, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import {
  loadDefaultSessionView,
  loadSessionViewOverrides,
  saveSessionViewOverrides,
  type MobileSessionView
} from '../storage/preferences'

type ViewOverridesState = {
  hostId: string
  worktreeId: string
  overrides: Map<string, MobileSessionView>
  loaded: boolean
}

type ViewOverridesRuntime = {
  hostId: string
  worktreeId: string
  loadPromise: Promise<Map<string, MobileSessionView>>
  currentOverrides: Map<string, MobileSessionView>
  mutationRevision: number
  lastQueuedMutationRevision: number
  saveQueue: Promise<void>
}

function isOverrideScope(state: ViewOverridesState, hostId: string, worktreeId: string): boolean {
  return state.hostId === hostId && state.worktreeId === worktreeId
}

function mergeOverrides(
  persisted: ReadonlyMap<string, MobileSessionView>,
  current: ReadonlyMap<string, MobileSessionView>
): Map<string, MobileSessionView> {
  const merged = new Map(persisted)
  for (const [tabId, view] of current) {
    merged.set(tabId, view)
  }
  return merged
}

export type MobileSessionViewModeController = {
  /** Whether a tab's effective view is chat (per-tab override, else the default). */
  isTabChatView: (tabId: string) => boolean
  toggleTabChatView: (tabId: string) => void
}

/** Resolves each tab's terminal/chat view: a per-device default (reloaded on focus
 *  so a Settings change applies without remounting the route) overlaid by persisted
 *  per-tab overrides that pin a session regardless of what the default later becomes. */
export function useMobileSessionViewMode(args: {
  hostId: string
  worktreeId: string
}): MobileSessionViewModeController {
  const { hostId, worktreeId } = args
  const [viewOverridesState, setViewOverridesState] = useState<ViewOverridesState>(() => ({
    hostId,
    worktreeId,
    overrides: new Map(),
    loaded: false
  }))
  const viewOverridesStateRef = useRef(viewOverridesState)
  viewOverridesStateRef.current = viewOverridesState
  const viewOverridesRuntimeRef = useRef<ViewOverridesRuntime | null>(null)
  const ensureViewOverridesRuntime = useCallback((scopeHostId: string, scopeWorktreeId: string) => {
    const current = viewOverridesRuntimeRef.current
    if (current?.hostId === scopeHostId && current.worktreeId === scopeWorktreeId) {
      return current
    }
    const next: ViewOverridesRuntime = {
      hostId: scopeHostId,
      worktreeId: scopeWorktreeId,
      loadPromise: loadSessionViewOverrides(scopeHostId, scopeWorktreeId),
      currentOverrides: new Map(),
      mutationRevision: 0,
      lastQueuedMutationRevision: 0,
      saveQueue: Promise.resolve()
    }
    viewOverridesRuntimeRef.current = next
    return next
  }, [])
  const [defaultView, setDefaultView] = useState<MobileSessionView>('terminal')
  // Why: the toggle callback reads the live default without depending on it, so
  // its identity stays stable and it never captures a stale default.
  const defaultViewRef = useRef(defaultView)
  defaultViewRef.current = defaultView

  useEffect(() => {
    let active = true
    const runtime = ensureViewOverridesRuntime(hostId, worktreeId)
    void runtime.loadPromise.then((persisted) => {
      if (!active) {
        return
      }
      // Why: toggles made during the read are authoritative, but must not
      // discard unrelated persisted overrides from the same worktree.
      const merged = mergeOverrides(persisted, runtime.currentOverrides)
      runtime.currentOverrides = merged
      const next = { hostId, worktreeId, overrides: merged, loaded: true }
      viewOverridesStateRef.current = next
      setViewOverridesState(next)
    })
    return () => {
      active = false
    }
  }, [ensureViewOverridesRuntime, hostId, worktreeId])

  // Why: reload on focus so returning from Settings picks up a changed default.
  useFocusEffect(
    useCallback(() => {
      let active = true
      void loadDefaultSessionView().then((view) => {
        if (active) {
          setDefaultView(view)
        }
      })
      return () => {
        active = false
      }
    }, [])
  )

  const isTabChatView = useCallback(
    (tabId: string): boolean => {
      if (!isOverrideScope(viewOverridesState, hostId, worktreeId)) {
        return false
      }
      const override = viewOverridesState.overrides.get(tabId)
      // Until this scope loads, only an immediate user toggle is authoritative;
      // defaulting other tabs to terminal avoids activating stale cross-host chat.
      return (override ?? (viewOverridesState.loaded ? defaultView : 'terminal')) === 'chat'
    },
    [defaultView, hostId, viewOverridesState, worktreeId]
  )

  const toggleTabChatView = useCallback(
    (tabId: string) => {
      const current = viewOverridesStateRef.current
      const currentScope = isOverrideScope(current, hostId, worktreeId)
        ? current
        : {
            hostId,
            worktreeId,
            overrides: new Map<string, MobileSessionView>(),
            loaded: false
          }
      const overrides = new Map(currentScope.overrides)
      // Flip from the tab's effective view (its override, else the default), so
      // a tab following a chat default can still be pinned back to terminal.
      const currentlyChat = (overrides.get(tabId) ?? defaultViewRef.current) === 'chat'
      overrides.set(tabId, currentlyChat ? 'terminal' : 'chat')
      const next = { ...currentScope, overrides }
      viewOverridesStateRef.current = next
      setViewOverridesState(next)

      const runtime = ensureViewOverridesRuntime(hostId, worktreeId)
      runtime.currentOverrides = overrides
      runtime.mutationRevision += 1
      // Persistence follows the already-started read so an early toggle merges
      // with saved siblings, and it continues even if the route unmounts.
      void runtime.loadPromise.then((persisted) => {
        if (runtime.mutationRevision <= runtime.lastQueuedMutationRevision) {
          return
        }
        runtime.lastQueuedMutationRevision = runtime.mutationRevision
        const snapshot = mergeOverrides(persisted, runtime.currentOverrides)
        // Why: serialized writes prevent an older, slower AsyncStorage write from
        // landing after a newer toggle and restoring stale persisted state.
        runtime.saveQueue = runtime.saveQueue
          .then(() => saveSessionViewOverrides(hostId, worktreeId, snapshot))
          .catch(() => undefined)
      })
    },
    [ensureViewOverridesRuntime, hostId, worktreeId]
  )

  return { isTabChatView, toggleTabChatView }
}

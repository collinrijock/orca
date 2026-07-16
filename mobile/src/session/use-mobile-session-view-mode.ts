import { useCallback, useEffect, useRef, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import {
  loadDefaultSessionView,
  loadSessionViewOverrides,
  saveSessionViewOverrides,
  type MobileSessionView
} from '../storage/preferences'

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
  const [viewOverrides, setViewOverrides] = useState<Map<string, MobileSessionView>>(new Map())
  const viewOverridesToggledRef = useRef(false)
  const [defaultView, setDefaultView] = useState<MobileSessionView>('terminal')
  // Why: the toggle callback reads the live default without depending on it, so
  // its identity stays stable and it never captures a stale default.
  const defaultViewRef = useRef(defaultView)
  defaultViewRef.current = defaultView

  useEffect(() => {
    let active = true
    // Re-arm per host/worktree so the fresh load can seed the new overrides.
    viewOverridesToggledRef.current = false
    void loadSessionViewOverrides(hostId, worktreeId).then((overrides) => {
      // Why: a toggle before this load resolves is authoritative; the load must
      // not revert the user's in-memory choice back to the persisted state.
      if (active && !viewOverridesToggledRef.current) {
        setViewOverrides(new Map(overrides))
      }
    })
    return () => {
      active = false
    }
  }, [hostId, worktreeId])

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
    (tabId: string): boolean => (viewOverrides.get(tabId) ?? defaultView) === 'chat',
    [viewOverrides, defaultView]
  )

  const toggleTabChatView = useCallback(
    (tabId: string) => {
      viewOverridesToggledRef.current = true
      setViewOverrides((previous) => {
        const next = new Map(previous)
        // Flip from the tab's effective view (its override, else the default), so
        // a tab following a chat default can still be pinned back to terminal.
        const currentlyChat = (previous.get(tabId) ?? defaultViewRef.current) === 'chat'
        next.set(tabId, currentlyChat ? 'terminal' : 'chat')
        void saveSessionViewOverrides(hostId, worktreeId, next)
        return next
      })
    },
    [hostId, worktreeId]
  )

  return { isTabChatView, toggleTabChatView }
}

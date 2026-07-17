import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DEFAULT_SESSION_VIEW,
  loadDefaultSessionView,
  saveDefaultSessionView,
  type MobileSessionView
} from '../storage/preferences'

export type MobileDefaultSessionViewPreference = {
  defaultView: MobileSessionView
  setDefaultView: (view: MobileSessionView) => void
}

type PendingDefaultViewWrite = {
  view: MobileSessionView
  revision: number
}

/** Owns the optimistic Settings value while keeping AsyncStorage writes ordered. */
export function useMobileDefaultSessionViewPreference(): MobileDefaultSessionViewPreference {
  const [defaultView, setDefaultViewState] = useState<MobileSessionView>(DEFAULT_SESSION_VIEW)
  const mountedRef = useRef(false)
  const mutationRevisionRef = useRef(0)
  const pendingWriteRef = useRef<PendingDefaultViewWrite | null>(null)
  const writeInFlightRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    const loadRevision = mutationRevisionRef.current
    let stale = false
    void loadDefaultSessionView().then((view) => {
      // Why: a fast toggle is authoritative over the older storage read.
      if (!stale && mutationRevisionRef.current === loadRevision) {
        setDefaultViewState(view)
      }
    })
    return () => {
      stale = true
      mountedRef.current = false
    }
  }, [])

  const flushPendingWrites = useCallback(async () => {
    if (writeInFlightRef.current) {
      return
    }
    writeInFlightRef.current = true
    try {
      while (pendingWriteRef.current) {
        const pending = pendingWriteRef.current
        pendingWriteRef.current = null
        try {
          await saveDefaultSessionView(pending.view)
        } catch {
          const persisted = await loadDefaultSessionView()
          // Why: only the latest failed toggle may roll the optimistic UI back.
          if (mountedRef.current && mutationRevisionRef.current === pending.revision) {
            setDefaultViewState(persisted)
          }
        }
      }
    } finally {
      writeInFlightRef.current = false
    }
  }, [])

  const setDefaultView = useCallback(
    (view: MobileSessionView) => {
      const revision = mutationRevisionRef.current + 1
      mutationRevisionRef.current = revision
      setDefaultViewState(view)
      // Why: retain only the latest queued choice while an older write is active.
      pendingWriteRef.current = { view, revision }
      void flushPendingWrites()
    },
    [flushPendingWrites]
  )

  return { defaultView, setDefaultView }
}

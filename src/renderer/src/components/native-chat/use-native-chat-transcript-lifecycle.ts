import { useCallback, useMemo, useRef, useState } from 'react'
import type { NativeChatTurnLifecycle } from '../../../../shared/native-chat-types'

type TranscriptLifecycleState = {
  lifecycle?: NativeChatTurnLifecycle
  capable: boolean
}

type TranscriptLifecycleControl = {
  reset: () => void
  replace: (lifecycle: NativeChatTurnLifecycle | undefined, capable: boolean) => void
  append: (lifecycle: NativeChatTurnLifecycle | undefined, capable: boolean) => void
  revision: () => number
  replaceFromPagination: (lifecycle: NativeChatTurnLifecycle | undefined, revision: number) => void
}

export function useNativeChatTranscriptLifecycle(): readonly [
  NativeChatTurnLifecycle | undefined,
  boolean,
  TranscriptLifecycleControl
] {
  const [state, setState] = useState<TranscriptLifecycleState>({ capable: false })
  // Why: pagination may resolve after a live completion; its older boundary
  // can update history only when no live lifecycle write won the race.
  const revisionRef = useRef(0)

  const replace = useCallback(
    (lifecycle: NativeChatTurnLifecycle | undefined, capable: boolean): void => {
      revisionRef.current += 1
      setState({ lifecycle, capable })
    },
    []
  )
  const reset = useCallback((): void => replace(undefined, false), [replace])
  const append = useCallback(
    (lifecycle: NativeChatTurnLifecycle | undefined, capable: boolean): void => {
      if (lifecycle) {
        revisionRef.current += 1
      }
      setState((current) => {
        if (!lifecycle && current.capable === capable) {
          return current
        }
        return { lifecycle: lifecycle ?? current.lifecycle, capable }
      })
    },
    []
  )
  const revision = useCallback((): number => revisionRef.current, [])
  const replaceFromPagination = useCallback(
    (lifecycle: NativeChatTurnLifecycle | undefined, expectedRevision: number): void => {
      if (!lifecycle || revisionRef.current !== expectedRevision) {
        return
      }
      revisionRef.current += 1
      setState((current) => ({ ...current, lifecycle }))
    },
    []
  )

  const control = useMemo<TranscriptLifecycleControl>(
    () => ({ reset, replace, append, revision, replaceFromPagination }),
    [append, replace, replaceFromPagination, reset, revision]
  )
  return [state.lifecycle, state.capable, control]
}

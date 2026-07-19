import { useCallback, useEffect, useRef } from 'react'
import { useAppStore } from '@/store'
import type { TuiAgent } from '../../../shared/types'

export type UseDetectedAgentsResult = {
  /** Null while detection is in flight on first load. */
  detectedIds: TuiAgent[] | null
  isLoading: boolean
  isRefreshing: boolean
  /** Forces fresh detection on the selected local, SSH, or runtime host.
   *  Idempotent while in flight: concurrent callers receive the same promise. */
  refresh: () => Promise<TuiAgent[]>
}

export type AgentDetectionTarget =
  | { kind: 'local' }
  | { kind: 'ssh'; connectionId: string }
  | { kind: 'runtime'; environmentId: string }

function normalizeAgentDetectionTarget(
  target: AgentDetectionTarget | string | null | undefined
): AgentDetectionTarget | undefined {
  if (target === undefined) {
    return undefined
  }
  if (target === null) {
    return { kind: 'local' }
  }
  if (typeof target === 'string') {
    return { kind: 'ssh', connectionId: target }
  }
  return target
}

/**
 * Single source of truth for detected agent IDs across the renderer.
 *
 * Why: previously AgentsPane, NewWorkspaceComposerCard, and
 * `detect-agents-cached.ts` each ran their own detection. A tab-bar button
 * that doesn't refresh when Settings → Agents refreshes would feel broken;
 * centralizing the state eliminates multi-owner drift.
 *
 * @param connectionId — Pass a string for legacy SSH callers, or an
 * AgentDetectionTarget for local/SSH/runtime hosts. Pass null for local
 * detection. Pass undefined when the connection context is not yet known
 * (store not hydrated) — returns loading state.
 */
export function useDetectedAgents(
  connectionId: AgentDetectionTarget | string | null | undefined = null
): UseDetectedAgentsResult {
  const target = normalizeAgentDetectionTarget(connectionId)
  const retriedEmptyTargetRef = useRef<string | null>(null)
  // Why: undefined means "store not yet hydrated" — we don't know if the
  // worktree is local or remote yet. This prevents flashing local agents for
  // remote worktrees during hydration.
  const isUnknown = target === undefined
  const targetKind = target?.kind
  const targetId =
    target?.kind === 'ssh'
      ? target.connectionId
      : target?.kind === 'runtime'
        ? target.environmentId
        : null

  const detectedIds = useAppStore((s) => {
    if (isUnknown) {
      return null
    }
    if (targetKind === 'ssh' && targetId) {
      return s.remoteDetectedAgentIds[targetId] ?? null
    }
    if (targetKind === 'runtime' && targetId) {
      return s.runtimeDetectedAgentIds[targetId] ?? null
    }
    return s.detectedAgentIds
  })
  const detectionInFlight = useAppStore((s) => {
    if (isUnknown) {
      return false
    }
    if (targetKind === 'ssh' && targetId) {
      return s.isDetectingRemoteAgents[targetId] ?? false
    }
    if (targetKind === 'runtime' && targetId) {
      return s.isDetectingRuntimeAgents[targetId] ?? false
    }
    return s.isDetectingAgents
  })
  const localRefreshInFlight = useAppStore((s) => s.isRefreshingAgents)
  const isLoading =
    isUnknown ||
    (targetKind === 'local' ? detectionInFlight : detectedIds === null && detectionInFlight)
  const isRefreshing =
    targetKind === 'local'
      ? localRefreshInFlight
      : !isUnknown && detectedIds !== null && detectionInFlight
  const ensureLocal = useAppStore((s) => s.ensureDetectedAgents)
  const ensureRemote = useAppStore((s) => s.ensureRemoteDetectedAgents)
  const ensureRuntime = useAppStore((s) => s.ensureRuntimeDetectedAgents)
  const refreshLocal = useAppStore((s) => s.refreshDetectedAgents)
  const refresh = useCallback((): Promise<TuiAgent[]> => {
    if (targetKind === 'ssh' && targetId) {
      retriedEmptyTargetRef.current = `ssh:${targetId}`
      return ensureRemote(targetId, { force: true })
    }
    if (targetKind === 'runtime' && targetId) {
      retriedEmptyTargetRef.current = `runtime:${targetId}`
      return ensureRuntime(targetId, { force: true })
    }
    if (targetKind === 'local') {
      return refreshLocal()
    }
    return Promise.resolve([])
  }, [ensureRemote, ensureRuntime, refreshLocal, targetId, targetKind])

  useEffect(() => {
    if (isUnknown) {
      return
    }
    const emptyRetryKey =
      targetKind === 'ssh' && targetId
        ? `ssh:${targetId}`
        : targetKind === 'runtime' && targetId
          ? `runtime:${targetId}`
          : null
    if (targetKind === 'ssh' && targetId) {
      if (detectedIds === null) {
        retriedEmptyTargetRef.current = emptyRetryKey
        void ensureRemote(targetId)
      } else if (detectedIds.length === 0 && retriedEmptyTargetRef.current !== emptyRetryKey) {
        // Why: a newly opened remote launch surface should get one fresh probe
        // after a prior empty result, but must not spin while the host has no agents.
        retriedEmptyTargetRef.current = emptyRetryKey
        void ensureRemote(targetId)
      }
    } else if (targetKind === 'runtime' && targetId) {
      if (detectedIds === null) {
        retriedEmptyTargetRef.current = emptyRetryKey
        void ensureRuntime(targetId)
      } else if (detectedIds.length === 0 && retriedEmptyTargetRef.current !== emptyRetryKey) {
        // Why: remote `orca serve` users can install/fix PATH without reconnecting;
        // retry once per mounted surface so the menu can pick that up.
        retriedEmptyTargetRef.current = emptyRetryKey
        void ensureRuntime(targetId)
      }
    } else {
      if (detectedIds === null) {
        void ensureLocal()
      }
    }
  }, [isUnknown, targetKind, targetId, detectedIds, ensureLocal, ensureRemote, ensureRuntime])

  return { detectedIds, isLoading, isRefreshing, refresh }
}

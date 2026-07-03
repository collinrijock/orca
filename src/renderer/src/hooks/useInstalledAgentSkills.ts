import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  DiscoveredSkill,
  SkillDiscoveryResult,
  SkillDiscoveryTarget,
  SkillSourceKind
} from '../../../shared/skills'
import { markOrchestrationSetupComplete } from '@/lib/orchestration-setup-state'
import {
  discoverInstalledAgentSkills,
  getCachedSkillDiscovery,
  getSkillDiscoveryErrorMessage,
  getSkillDiscoveryTargetKey,
  isOrchestrationSkillName,
  isSuppressedSkillDiscoveryResult,
  subscribeSkillDiscoveryBroadcasts,
  waitForNextSkillDiscoveryBroadcast
} from './installed-agent-skill-discovery'
import { hasInstalledAgentSkillNamed, normalizeSkillName } from './installed-agent-skill-matching'
import { useMountedRef } from './useMountedRef'

export {
  hasInstalledAgentSkill,
  hasInstalledAgentSkillNamed
} from './installed-agent-skill-matching'
export {
  _installedAgentSkillDiscoveryInternalsForTests,
  markAgentSkillInstallCommandCopied
} from './installed-agent-skill-discovery'

export const GLOBAL_AGENT_SKILL_SOURCE_KINDS = [
  'home'
] as const satisfies readonly SkillSourceKind[]

type InstalledAgentSkillOptions = {
  enabled?: boolean
  discoveryTarget?: SkillDiscoveryTarget
  sourceKinds?: readonly SkillSourceKind[]
}

export type InstalledAgentSkillState = {
  installed: boolean
  loading: boolean
  error: string | null
  skills: readonly DiscoveredSkill[]
  refresh: () => Promise<boolean>
}

export function useInstalledAgentSkill(
  skillName: string,
  options: InstalledAgentSkillOptions = {}
): InstalledAgentSkillState {
  return useInstalledAgentSkillNames([skillName], options)
}

export function useInstalledAgentSkillNames(
  skillNames: readonly string[],
  options: InstalledAgentSkillOptions = {}
): InstalledAgentSkillState {
  const { enabled = true, discoveryTarget, sourceKinds } = options
  const skillNamesKey = skillNames.map(normalizeSkillName).join('\n')
  const candidateSkillNames = useMemo(() => skillNamesKey.split('\n'), [skillNamesKey])
  const discoveryTargetKey = getSkillDiscoveryTargetKey(discoveryTarget)
  // Why: callers rebuild the target object every store churn; keying refresh on
  // the object identity would turn each churn into a forced disk scan. Only the
  // target KEY participates in identity — the ref carries the latest object.
  const discoveryTargetRef = useRef(discoveryTarget)
  discoveryTargetRef.current = discoveryTarget
  const sourceKindsKey = sourceKinds ? sourceKinds.join('\n') : null
  const stableSourceKinds = useMemo(
    () =>
      sourceKindsKey === null
        ? undefined
        : sourceKindsKey === ''
          ? ([] as SkillSourceKind[])
          : (sourceKindsKey.split('\n') as SkillSourceKind[]),
    [sourceKindsKey]
  )
  const cachedDiscovery = getCachedSkillDiscovery(discoveryTargetKey)
  const [result, setResult] = useState<SkillDiscoveryResult | null>(cachedDiscovery)
  const [loading, setLoading] = useState(enabled && !cachedDiscovery)
  const [error, setError] = useState<string | null>(null)
  const currentDiscoveryTargetKeyRef = useRef(discoveryTargetKey)
  const refreshGenerationRef = useRef(0)
  const stateResetInputRef = useRef({ discoveryTargetKey, enabled })
  currentDiscoveryTargetKeyRef.current = discoveryTargetKey
  // Why: skill scans can outlive transient settings/onboarding panels; keep
  // the module cache update but skip React state writes after unmount.
  const mountedRef = useMountedRef()
  let resultForRender = result
  let loadingForRender = loading
  let errorForRender = error
  if (
    stateResetInputRef.current.discoveryTargetKey !== discoveryTargetKey ||
    stateResetInputRef.current.enabled !== enabled
  ) {
    const nextCachedDiscovery = getCachedSkillDiscovery(discoveryTargetKey)
    const nextLoading = enabled && !nextCachedDiscovery
    stateResetInputRef.current = { discoveryTargetKey, enabled }
    resultForRender = nextCachedDiscovery
    loadingForRender = nextLoading
    errorForRender = null
    setResult(nextCachedDiscovery)
    setLoading(nextLoading)
    setError(null)
  }

  const refresh = useCallback(
    async (force = true, readAfterPending = false): Promise<boolean> => {
      const requestDiscoveryTargetKey = discoveryTargetKey
      const requestGeneration = ++refreshGenerationRef.current
      const writeIfCurrent = (write: () => void): void => {
        if (
          mountedRef.current &&
          requestGeneration === refreshGenerationRef.current &&
          currentDiscoveryTargetKeyRef.current === requestDiscoveryTargetKey
        ) {
          write()
        }
      }

      if (!enabled) {
        writeIfCurrent(() => {
          setLoading(false)
        })
        return false
      }
      writeIfCurrent(() => {
        setLoading(true)
      })
      let installedAfterRefresh = false
      let suppressedResult = false
      try {
        let next = await discoverInstalledAgentSkills(
          force,
          discoveryTargetRef.current,
          readAfterPending
        )
        if (isSuppressedSkillDiscoveryResult(next)) {
          // Why: a concurrent explicit re-check replaced this scan; resolving
          // false here would misreport an installed skill to the caller.
          const replacement = await waitForNextSkillDiscoveryBroadcast(requestDiscoveryTargetKey)
          if (!replacement) {
            suppressedResult = true
            return false
          }
          next = replacement
        }
        installedAfterRefresh = hasInstalledAgentSkillNamed(next.skills, candidateSkillNames, {
          sourceKinds: stableSourceKinds
        })
        writeIfCurrent(() => {
          setResult(next)
          setError(null)
        })
      } catch (refreshError) {
        writeIfCurrent(() => {
          setError(getSkillDiscoveryErrorMessage(refreshError))
        })
      } finally {
        if (!suppressedResult) {
          writeIfCurrent(() => {
            setLoading(false)
          })
        }
      }
      return installedAfterRefresh
    },
    [candidateSkillNames, discoveryTargetKey, enabled, mountedRef, stableSourceKinds]
  )

  useEffect(() => {
    // Why: explicit product surfaces should read current disk state, not a session-old cache.
    void refresh(true)
  }, [refresh])

  useEffect(() => {
    if (!enabled) {
      return
    }
    // Why: explicit refreshes can be initiated by a sibling setup panel while
    // setup-guide progress or settings nav badges are mounted elsewhere.
    const onResult = (key: string, next: SkillDiscoveryResult): void => {
      if (!mountedRef.current || key !== currentDiscoveryTargetKeyRef.current) {
        return
      }
      setResult(next)
      setError(null)
      setLoading(false)
    }
    const onFailure = (key: string, refreshError: unknown): void => {
      if (!mountedRef.current || key !== currentDiscoveryTargetKeyRef.current) {
        return
      }
      setError(getSkillDiscoveryErrorMessage(refreshError))
      setLoading(false)
    }
    return subscribeSkillDiscoveryBroadcasts(onResult, onFailure)
  }, [enabled, mountedRef])

  const skills = useMemo(
    () => (enabled && resultForRender ? resultForRender.skills : []),
    [enabled, resultForRender]
  )

  const installed = useMemo(
    () =>
      enabled
        ? hasInstalledAgentSkillNamed(skills, candidateSkillNames, {
            sourceKinds: stableSourceKinds
          })
        : false,
    [candidateSkillNames, enabled, skills, stableSourceKinds]
  )

  useEffect(() => {
    if (installed && candidateSkillNames.some(isOrchestrationSkillName)) {
      // Why: older floating-workspace education still keys off this marker; any
      // surface that detects the orchestration skill should satisfy setup.
      markOrchestrationSetupComplete()
    }
  }, [candidateSkillNames, installed])

  const forceRefresh = useCallback(() => refresh(true, true), [refresh])

  return {
    installed,
    loading: loadingForRender,
    error: errorForRender,
    skills,
    refresh: forceRefresh
  }
}

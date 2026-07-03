import type { SkillDiscoveryResult, SkillDiscoveryTarget } from '../../../shared/skills'
import { ORCHESTRATION_SKILL_NAME } from '@/lib/agent-feature-install-commands'
import { normalizeSkillName } from './installed-agent-skill-matching'

let cachedDiscoveryByTarget = new Map<string, SkillDiscoveryResult>()
let pendingDiscoveryByTarget = new Map<string, Promise<SkillDiscoveryResult>>()
let pendingDiscoverySatisfiesForcedRefreshByTarget = new Map<string, boolean>()
let knownDiscoveryTargetsByKey = new Map<string, SkillDiscoveryTarget | undefined>()
let externalSkillInstallPossiblyPending = false
let externalInstallFocusListenerRegistered = false
let discoveryCacheListeners = new Set<(key: string, result: SkillDiscoveryResult) => void>()
let discoveryFailureListeners = new Set<(key: string, error: unknown) => void>()
let suppressedDiscoveryPromises = new WeakSet<Promise<SkillDiscoveryResult>>()
let suppressedDiscoveryResults = new WeakSet<SkillDiscoveryResult>()

export function isOrchestrationSkillName(skillName: string): boolean {
  return normalizeSkillName(skillName) === ORCHESTRATION_SKILL_NAME
}

export function getSkillDiscoveryErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Could not scan installed skills.'
}

function normalizeSkillDiscoveryTarget(
  target: SkillDiscoveryTarget | undefined
): SkillDiscoveryTarget | undefined {
  const projectRuntime = target?.projectRuntime
  if (projectRuntime) {
    if (projectRuntime.status === 'repair-required') {
      return { projectRuntime }
    }
    if (projectRuntime.runtime.kind === 'wsl') {
      return {
        runtime: 'wsl',
        wslDistro: projectRuntime.runtime.distro,
        projectRuntime
      }
    }
    return {
      runtime: 'host',
      projectRuntime
    }
  }

  if (target?.runtime !== 'wsl') {
    return undefined
  }
  return { runtime: 'wsl', wslDistro: target.wslDistro?.trim() || null }
}

export function getSkillDiscoveryTargetKey(target: SkillDiscoveryTarget | undefined): string {
  if (target?.projectRuntime) {
    return target.projectRuntime.status === 'resolved'
      ? target.projectRuntime.runtime.cacheKey
      : target.projectRuntime.repair.cacheKey
  }
  const normalizedTarget = normalizeSkillDiscoveryTarget(target)
  return normalizedTarget?.runtime === 'wsl' ? `wsl:${normalizedTarget.wslDistro ?? ''}` : 'host'
}

export function getCachedSkillDiscovery(key: string): SkillDiscoveryResult | null {
  return cachedDiscoveryByTarget.get(key) ?? null
}

export function isSuppressedSkillDiscoveryResult(result: SkillDiscoveryResult): boolean {
  return suppressedDiscoveryResults.has(result)
}

export function subscribeSkillDiscoveryBroadcasts(
  onResult: (key: string, result: SkillDiscoveryResult) => void,
  onFailure: (key: string, error: unknown) => void
): () => void {
  discoveryCacheListeners.add(onResult)
  discoveryFailureListeners.add(onFailure)
  return () => {
    discoveryCacheListeners.delete(onResult)
    discoveryFailureListeners.delete(onFailure)
  }
}

function startInstalledAgentSkillDiscovery(
  force: boolean,
  target: SkillDiscoveryTarget | undefined
): Promise<SkillDiscoveryResult> {
  const key = getSkillDiscoveryTargetKey(target)
  const normalizedTarget = normalizeSkillDiscoveryTarget(target)
  const discovery = window.api.skills
    .discover(normalizedTarget)
    .then((result) => {
      cachedDiscoveryByTarget.set(key, result)
      if (suppressedDiscoveryPromises.has(discovery)) {
        suppressedDiscoveryResults.add(result)
        return result
      }
      for (const listener of discoveryCacheListeners) {
        listener(key, result)
      }
      return result
    })
    .catch((error) => {
      if (!suppressedDiscoveryPromises.has(discovery)) {
        for (const listener of discoveryFailureListeners) {
          listener(key, error)
        }
      }
      throw error
    })
    .finally(() => {
      if (pendingDiscoveryByTarget.get(key) === discovery) {
        pendingDiscoveryByTarget.delete(key)
        pendingDiscoverySatisfiesForcedRefreshByTarget.delete(key)
      }
    })
  pendingDiscoveryByTarget.set(key, discovery)
  pendingDiscoverySatisfiesForcedRefreshByTarget.set(key, force)
  return discovery
}

export async function discoverInstalledAgentSkills(
  force: boolean,
  target?: SkillDiscoveryTarget,
  readAfterPending = false
): Promise<SkillDiscoveryResult> {
  const key = getSkillDiscoveryTargetKey(target)
  // Why: the copy-armed focus rescan needs a live target per key; keys alone
  // cannot reconstruct project-runtime targets.
  knownDiscoveryTargetsByKey.set(key, target)
  const cachedDiscovery = cachedDiscoveryByTarget.get(key)
  if (!force && cachedDiscovery) {
    return cachedDiscovery
  }

  const inFlightDiscovery = pendingDiscoveryByTarget.get(key)
  if (inFlightDiscovery) {
    if (!force || (!readAfterPending && pendingDiscoverySatisfiesForcedRefreshByTarget.get(key))) {
      return inFlightDiscovery
    }
    suppressedDiscoveryPromises.add(inFlightDiscovery)
    try {
      await inFlightDiscovery
    } catch {
      // Why: an explicit re-check should still read current disk state even if
      // the older background scan failed.
    }
    const nextPendingDiscovery = pendingDiscoveryByTarget.get(key)
    if (nextPendingDiscovery && nextPendingDiscovery !== inFlightDiscovery) {
      return nextPendingDiscovery
    }
  }

  return startInstalledAgentSkillDiscovery(force, target)
}

// Why: copied install commands run in terminals Orca cannot observe. Arming a
// one-shot rescan on the next window focus covers that flow without
// reintroducing scan-on-every-focus churn on passive surfaces.
export function markAgentSkillInstallCommandCopied(): void {
  externalSkillInstallPossiblyPending = true
  if (externalInstallFocusListenerRegistered || typeof window === 'undefined') {
    return
  }
  externalInstallFocusListenerRegistered = true
  window.addEventListener('focus', () => {
    if (!externalSkillInstallPossiblyPending) {
      return
    }
    externalSkillInstallPossiblyPending = false
    for (const target of knownDiscoveryTargetsByKey.values()) {
      void discoverInstalledAgentSkills(true, target, true).catch(() => {
        // Broadcast listeners surface scan failures on the owning surfaces.
      })
    }
  })
}

// Why: a caller whose awaited scan was suppressed by a concurrent explicit
// re-check must resolve from the replacement scan, not report stale state.
// Subscription happens before the suppressor can start the replacement, so
// the next broadcast for this key is always the replacement's outcome.
export function waitForNextSkillDiscoveryBroadcast(
  key: string
): Promise<SkillDiscoveryResult | null> {
  return new Promise((resolve) => {
    const onResult = (eventKey: string, result: SkillDiscoveryResult): void => {
      if (eventKey !== key) {
        return
      }
      unsubscribe()
      resolve(result)
    }
    const onFailure = (eventKey: string): void => {
      if (eventKey !== key) {
        return
      }
      unsubscribe()
      resolve(null)
    }
    const unsubscribe = subscribeSkillDiscoveryBroadcasts(onResult, onFailure)
  })
}

export const _installedAgentSkillDiscoveryInternalsForTests = {
  discoverInstalledAgentSkills,
  getSkillDiscoveryTargetKey,
  isOrchestrationSkillName,
  reset(): void {
    cachedDiscoveryByTarget = new Map()
    pendingDiscoveryByTarget = new Map()
    pendingDiscoverySatisfiesForcedRefreshByTarget = new Map()
    knownDiscoveryTargetsByKey = new Map()
    externalSkillInstallPossiblyPending = false
    externalInstallFocusListenerRegistered = false
    discoveryCacheListeners = new Set()
    discoveryFailureListeners = new Set()
    suppressedDiscoveryPromises = new WeakSet()
    suppressedDiscoveryResults = new WeakSet()
  }
}

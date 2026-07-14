import { useCallback, useEffect, useState } from 'react'
import type { SkillFreshnessInventory } from '../../../shared/skill-freshness'
import { useMountedRef } from './useMountedRef'

const INSTALLED_SKILLS_CHANGED_EVENT = 'orca:installed-agent-skills-changed'
let cachedInventory: SkillFreshnessInventory | null = null
let pendingInventory: Promise<SkillFreshnessInventory> | null = null
let invalidationRevision = 0
let completedRevision = -1

async function loadInventory(force: boolean): Promise<SkillFreshnessInventory> {
  if (force) {
    invalidationRevision += 1
  }
  const targetRevision = invalidationRevision
  for (;;) {
    if (cachedInventory && completedRevision >= targetRevision) {
      return cachedInventory
    }
    if (!pendingInventory) {
      const requestRevision = invalidationRevision
      const request = window.api.skills
        .freshnessInventory()
        .then((inventory) => {
          cachedInventory = inventory
          completedRevision = Math.max(completedRevision, requestRevision)
          return inventory
        })
        .finally(() => {
          if (pendingInventory === request) {
            pendingInventory = null
          }
        })
      pendingInventory = request
    }
    await pendingInventory
  }
}

export type SkillFreshnessState = {
  inventory: SkillFreshnessInventory | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

export function useSkillFreshness(): SkillFreshnessState {
  const [inventory, setInventory] = useState<SkillFreshnessInventory | null>(cachedInventory)
  const [loading, setLoading] = useState(cachedInventory === null)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useMountedRef()

  const refresh = useCallback(
    async (force = true): Promise<void> => {
      setLoading(true)
      try {
        const next = await loadInventory(force)
        if (mountedRef.current) {
          setInventory(next)
          setError(null)
        }
      } catch (cause) {
        if (mountedRef.current) {
          setError(cause instanceof Error ? cause.message : 'Could not inspect Orca skills.')
        }
      } finally {
        if (mountedRef.current) {
          setLoading(false)
        }
      }
    },
    [mountedRef]
  )

  useEffect(() => {
    void refresh(false)
  }, [refresh])

  useEffect(() => {
    const invalidate = (): void => {
      cachedInventory = null
      void refresh(true)
    }
    window.addEventListener('focus', invalidate)
    window.addEventListener(INSTALLED_SKILLS_CHANGED_EVENT, invalidate)
    return () => {
      window.removeEventListener('focus', invalidate)
      window.removeEventListener(INSTALLED_SKILLS_CHANGED_EVENT, invalidate)
    }
  }, [refresh])

  return { inventory, loading, error, refresh: () => refresh(true) }
}

export const _skillFreshnessCacheForTests = {
  reset(): void {
    cachedInventory = null
    pendingInventory = null
    invalidationRevision = 0
    completedRevision = -1
  }
}

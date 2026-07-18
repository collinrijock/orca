import type { IPtyProvider } from '../providers/types'

export type DegradedFallbackShutdownResult = {
  stoppedIds: string[]
  failedIds: string[]
}

export async function shutdownDegradedFallbackSessions<T extends IPtyProvider>(
  sessionProviders: Map<string, T>,
  fallback: T
): Promise<DegradedFallbackShutdownResult> {
  const ids = [...sessionProviders]
    .filter(([, provider]) => provider === fallback)
    .map(([id]) => id)
  const results = await Promise.allSettled(
    ids.map(async (id) => {
      await fallback.shutdown(id, { immediate: true })
      sessionProviders.delete(id)
    })
  )
  const stoppedIds = ids.filter((_, index) => results[index].status === 'fulfilled')
  const failedIds = ids.filter((_, index) => results[index].status === 'rejected')
  return { stoppedIds, failedIds }
}

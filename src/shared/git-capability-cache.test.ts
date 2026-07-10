import { describe, expect, it, vi } from 'vitest'
import { GIT_CAPABILITY_RETRY_INTERVAL_MS, GitCapabilityCache } from './git-capability-cache'

describe('GitCapabilityCache', () => {
  it('retries a capability after the compatibility interval', () => {
    const cache = new GitCapabilityCache()
    cache.rememberUnsupported('worktree-list-z', 1_000)

    expect(cache.shouldTry('worktree-list-z', 1_000 + GIT_CAPABILITY_RETRY_INTERVAL_MS - 1)).toBe(
      false
    )
    expect(cache.shouldTry('worktree-list-z', 1_000 + GIT_CAPABILITY_RETRY_INTERVAL_MS)).toBe(true)
  })

  it('coalesces concurrent capability probes after an unsupported result', async () => {
    const cache = new GitCapabilityCache()
    let rejectProbe!: (error: Error) => void
    const firstPreferred = vi.fn(
      () =>
        new Promise<string>((_resolve, reject) => {
          rejectProbe = reject
        })
    )
    const secondPreferred = vi.fn(async () => 'unexpected')
    const firstFallback = vi.fn(async () => 'first-fallback')
    const secondFallback = vi.fn(async () => 'second-fallback')
    const isUnsupported = (error: unknown): boolean =>
      error instanceof Error && error.message === 'unsupported'

    const first = cache.runWithFallback(
      'for-each-ref-exclude',
      firstPreferred,
      firstFallback,
      isUnsupported
    )
    const second = cache.runWithFallback(
      'for-each-ref-exclude',
      secondPreferred,
      secondFallback,
      isUnsupported
    )
    rejectProbe(new Error('unsupported'))

    await expect(Promise.all([first, second])).resolves.toEqual([
      'first-fallback',
      'second-fallback'
    ])
    expect(firstPreferred).toHaveBeenCalledTimes(1)
    expect(secondPreferred).not.toHaveBeenCalled()
    expect(firstFallback).toHaveBeenCalledTimes(1)
    expect(secondFallback).toHaveBeenCalledTimes(1)
  })
})

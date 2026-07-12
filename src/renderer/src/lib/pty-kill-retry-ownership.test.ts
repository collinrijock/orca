import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  killPtyRetainingRetryOwnership,
  releaseRetainedPtyKillOwnership,
  retryRetainedPtyKills
} from './pty-kill-retry-ownership'

const IDS = Array.from({ length: 65 }, (_, index) => `pty-retained-${index}`)

describe('PTY kill retry ownership', () => {
  afterEach(() => {
    for (const id of IDS) {
      releaseRetainedPtyKillOwnership(id)
    }
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('bounds retained ids and retries at most one per lifecycle event', async () => {
    const kill = vi.fn().mockRejectedValue(new Error('provider disconnected'))
    vi.stubGlobal('window', { api: { pty: { kill } } })
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    for (const id of IDS) {
      await killPtyRetainingRetryOwnership(id, '[pty] failed').catch(() => {})
    }
    kill.mockResolvedValue(undefined)

    retryRetainedPtyKills()
    await Promise.resolve()
    await Promise.resolve()

    expect(kill).toHaveBeenCalledTimes(66)
    expect(kill.mock.calls.filter(([id]) => id === IDS[0])).toHaveLength(1)
    expect(kill.mock.calls.filter(([id]) => id === IDS[1])).toHaveLength(2)
  })
})

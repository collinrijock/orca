import { beforeEach, describe, expect, it, vi } from 'vitest'

const keepAwake = vi.hoisted(() => ({
  activate: vi.fn<(tag: string) => Promise<void>>(),
  deactivate: vi.fn<(tag: string) => Promise<void>>()
}))

vi.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: keepAwake.activate,
  deactivateKeepAwake: keepAwake.deactivate
}))

import { MobileDictationKeepAwakeOwner } from './mobile-dictation-keep-awake'

function deferred(): {
  promise: Promise<void>
  resolve: () => void
  reject: (error: Error) => void
} {
  let resolvePromise: (() => void) | undefined
  let rejectPromise: ((error: Error) => void) | undefined
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return {
    promise,
    resolve: () => resolvePromise?.(),
    reject: (error) => rejectPromise?.(error)
  }
}

describe('MobileDictationKeepAwakeOwner', () => {
  beforeEach(() => {
    keepAwake.activate.mockReset().mockResolvedValue(undefined)
    keepAwake.deactivate.mockReset().mockResolvedValue(undefined)
  })

  it('retries a failed native deactivation after the hook owner is replaced', async () => {
    const firstOwner = new MobileDictationKeepAwakeOwner()

    await firstOwner.acquire('first')
    const firstTag = keepAwake.activate.mock.calls[0]?.[0]
    expect(firstTag).toContain(':first')

    keepAwake.deactivate.mockRejectedValueOnce(new Error('Activity unavailable'))
    await expect(firstOwner.release('first')).rejects.toThrow('Activity unavailable')

    const replacementOwner = new MobileDictationKeepAwakeOwner()
    await replacementOwner.acquire('second')
    const secondTag = keepAwake.activate.mock.calls[1]?.[0]
    expect(secondTag).toContain(':second')
    expect(keepAwake.deactivate.mock.calls.slice(0, 2)).toEqual([[firstTag], [firstTag]])
    expect(keepAwake.deactivate.mock.invocationCallOrder[1]).toBeLessThan(
      keepAwake.activate.mock.invocationCallOrder[1] ?? 0
    )

    await replacementOwner.release('second')
  })

  it('serializes cancel and restart without letting a stale release deactivate the restart', async () => {
    const firstActivation = deferred()
    keepAwake.activate.mockImplementationOnce(() => firstActivation.promise)
    const owner = new MobileDictationKeepAwakeOwner()

    const acquireFirst = owner.acquire('first')
    const releaseFirst = owner.release('first')
    const acquireSecond = owner.acquire('second')
    firstActivation.resolve()
    await Promise.all([acquireFirst, releaseFirst, acquireSecond])

    const secondTag = keepAwake.activate.mock.calls[1]?.[0]
    await owner.release('first')
    expect(keepAwake.deactivate).toHaveBeenCalledTimes(1)

    await owner.release('second')
    expect(keepAwake.deactivate).toHaveBeenLastCalledWith(secondTag)
  })

  it('waits for an in-flight failed release before a replacement owner activates', async () => {
    const deactivation = deferred()
    const firstOwner = new MobileDictationKeepAwakeOwner()
    await firstOwner.acquire('first')
    keepAwake.deactivate.mockImplementationOnce(() => deactivation.promise)

    const releaseFirst = firstOwner.release('first')
    await Promise.resolve()
    expect(keepAwake.deactivate).toHaveBeenCalledOnce()

    const replacementOwner = new MobileDictationKeepAwakeOwner()
    const acquireReplacement = replacementOwner.acquire('replacement')
    expect(keepAwake.activate).toHaveBeenCalledOnce()

    deactivation.reject(new Error('Activity unavailable'))
    await expect(releaseFirst).rejects.toThrow('Activity unavailable')
    await acquireReplacement

    expect(keepAwake.deactivate).toHaveBeenCalledTimes(2)
    expect(keepAwake.activate).toHaveBeenCalledTimes(2)
    expect(keepAwake.deactivate.mock.invocationCallOrder[1]).toBeLessThan(
      keepAwake.activate.mock.invocationCallOrder[1] ?? 0
    )
    await replacementOwner.release('replacement')
  })
})

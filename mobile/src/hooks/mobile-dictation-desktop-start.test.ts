import { describe, expect, it, vi } from 'vitest'
import { startMobileDictationDesktopSession } from './mobile-dictation-desktop-start'
import type { MobileDictationKeepAwakeOwner } from './mobile-dictation-keep-awake'
import type { RpcClient } from '../transport/rpc-client'

const OK_RESPONSE = { ok: true, result: {} } as const

type StartHarnessOptions = {
  sendRequest?: (method: string) => Promise<unknown>
  acquire?: () => Promise<void>
}

function createStartHarness(options: StartHarnessOptions = {}) {
  let generation = 1
  let enabled = true
  let activeId: string | null = 'dictation-a'
  const setIdle = vi.fn()
  const release = vi.fn().mockResolvedValue(undefined)
  const sendRequest = vi.fn(
    options.sendRequest ?? (async () => OK_RESPONSE)
  ) as unknown as RpcClient['sendRequest']
  const client = { sendRequest } as RpcClient
  const keepAwakeOwner = {
    acquire: vi.fn(options.acquire ?? (async () => undefined)),
    release
  } as unknown as MobileDictationKeepAwakeOwner

  return {
    options: {
      client,
      dictationId: 'dictation-a',
      generation: 1,
      getCurrentGeneration: () => generation,
      getEnabled: () => enabled,
      getActiveId: () => activeId,
      clearActiveId: (dictationId: string) => {
        if (activeId === dictationId) {
          activeId = null
        }
      },
      setIdle,
      keepAwakeOwner
    },
    setNewerStart: () => {
      generation = 2
      activeId = 'dictation-b'
    },
    setDisabled: () => {
      enabled = false
    },
    getActiveId: () => activeId,
    setIdle,
    release
  }
}

describe('startMobileDictationDesktopSession', () => {
  it('does not reset UI state when a newer start supersedes keep-awake acquisition', async () => {
    let setNewerStart = () => undefined
    const harness = createStartHarness({
      acquire: async () => setNewerStart()
    })
    setNewerStart = harness.setNewerStart

    await expect(startMobileDictationDesktopSession(harness.options)).resolves.toBe(false)

    expect(harness.setIdle).not.toHaveBeenCalled()
    expect(harness.getActiveId()).toBe('dictation-b')
    expect(harness.release).toHaveBeenCalledWith('dictation-a')
  })

  it('returns to idle when disable makes keep-awake acquisition stale', async () => {
    let setDisabled = () => undefined
    const harness = createStartHarness({
      acquire: async () => setDisabled()
    })
    setDisabled = harness.setDisabled

    await expect(startMobileDictationDesktopSession(harness.options)).resolves.toBe(false)

    expect(harness.setIdle).toHaveBeenCalledOnce()
    expect(harness.getActiveId()).toBeNull()
    expect(harness.release).toHaveBeenCalledWith('dictation-a')
  })

  it('swallows a keep-awake failure if cleanup is superseded by a newer start', async () => {
    let setNewerStart = () => undefined
    const harness = createStartHarness({
      acquire: async () => {
        throw new Error('Keep awake failed')
      },
      sendRequest: async (method) => {
        if (method === 'speech.dictation.cancel') {
          setNewerStart()
        }
        return OK_RESPONSE
      }
    })
    setNewerStart = harness.setNewerStart

    await expect(startMobileDictationDesktopSession(harness.options)).resolves.toBe(false)

    expect(harness.setIdle).not.toHaveBeenCalled()
    expect(harness.getActiveId()).toBe('dictation-b')
  })

  it('still reports a keep-awake failure for the current start', async () => {
    const harness = createStartHarness({
      acquire: async () => {
        throw new Error('Keep awake failed')
      }
    })

    await expect(startMobileDictationDesktopSession(harness.options)).rejects.toThrow(
      'Keep awake failed'
    )

    expect(harness.setIdle).toHaveBeenCalledOnce()
    expect(harness.getActiveId()).toBeNull()
  })

  it('does not surface a desktop-start failure after the start became stale', async () => {
    let setNewerStart = () => undefined
    const harness = createStartHarness({
      sendRequest: async (method) => {
        if (method === 'speech.dictation.start') {
          setNewerStart()
          throw new Error('Desktop start failed')
        }
        return OK_RESPONSE
      }
    })
    setNewerStart = harness.setNewerStart

    await expect(startMobileDictationDesktopSession(harness.options)).resolves.toBe(false)

    expect(harness.setIdle).not.toHaveBeenCalled()
    expect(harness.getActiveId()).toBe('dictation-b')
  })
})

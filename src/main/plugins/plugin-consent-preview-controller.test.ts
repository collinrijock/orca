import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import type {
  PluginConsentPreviewRequest,
  PluginConsentPreviewResult
} from '../../shared/plugins/plugin-consent-preview'
import type { PluginService } from './plugin-service'
import { PluginConsentPreviewController } from './plugin-consent-preview-controller'

function pluginService(): PluginService {
  const plugins = new Map(
    ['first', 'second'].map((id) => [
      `orca-samples.${id}`,
      {
        pluginKey: `orca-samples.${id}`,
        rootDir: join('plugins', id),
        contentHash: `${id}-content`,
        consentFingerprint: `${id}-fingerprint`
      }
    ])
  )
  return {
    findValidPlugin: (pluginKey: string) => plugins.get(pluginKey) ?? null
  } as unknown as PluginService
}

function request(id: 'first' | 'second'): PluginConsentPreviewRequest {
  return {
    pluginKey: `orca-samples.${id}`,
    reviewedFingerprint: `${id}-fingerprint`
  }
}

const success: PluginConsentPreviewResult = {
  ok: true,
  skills: [{ name: 'review', instructions: '# Review' }]
}

describe('PluginConsentPreviewController', () => {
  it('coalesces the same immutable preview across clients and caches it', async () => {
    let finish!: (result: PluginConsentPreviewResult) => void
    const loader = vi.fn(
      () =>
        new Promise<PluginConsentPreviewResult>((resolve) => {
          finish = resolve
        })
    )
    const service = pluginService()
    const controller = new PluginConsentPreviewController(loader)

    const first = controller.preview(service, request('first'), { ownerKey: 'client-one' })
    const second = controller.preview(service, request('first'), { ownerKey: 'client-two' })
    expect(loader).toHaveBeenCalledOnce()
    finish(success)

    await expect(first).resolves.toEqual(success)
    await expect(second).resolves.toEqual(success)
    await expect(
      controller.preview(service, request('first'), { ownerKey: 'client-three' })
    ).resolves.toEqual(success)
    expect(loader).toHaveBeenCalledOnce()
  })

  it('rejects parallel work from one client and bounds distinct global loads', async () => {
    const loader = vi.fn(() => new Promise<PluginConsentPreviewResult>(() => {}))
    const service = pluginService()
    const controller = new PluginConsentPreviewController(loader, 1)

    void controller.preview(service, request('first'), { ownerKey: 'client-one' })

    await expect(
      controller.preview(service, request('second'), { ownerKey: 'client-one' })
    ).resolves.toEqual({ ok: false, error: 'plugin consent preview unavailable' })
    await expect(
      controller.preview(service, request('second'), { ownerKey: 'client-two' })
    ).resolves.toEqual({ ok: false, error: 'plugin consent preview unavailable' })
    expect(loader).toHaveBeenCalledOnce()
  })

  it('cancels the underlying read when its last client disconnects', async () => {
    const loader = vi.fn(
      (_service: PluginService, _request: PluginConsentPreviewRequest, signal?: AbortSignal) =>
        new Promise<PluginConsentPreviewResult>((resolve) => {
          signal?.addEventListener(
            'abort',
            () => resolve({ ok: false, error: 'plugin consent preview unavailable' }),
            { once: true }
          )
        })
    )
    const service = pluginService()
    const controller = new PluginConsentPreviewController(loader)
    const disconnected = new AbortController()
    const preview = controller.preview(service, request('first'), {
      ownerKey: 'client-one',
      signal: disconnected.signal
    })

    disconnected.abort()

    await expect(preview).resolves.toEqual({
      ok: false,
      error: 'plugin consent preview unavailable'
    })
    expect(loader.mock.calls[0]?.[2]?.aborted).toBe(true)
  })
})

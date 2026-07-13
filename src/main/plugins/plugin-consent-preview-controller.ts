import type {
  PluginConsentPreviewRequest,
  PluginConsentPreviewResult
} from '../../shared/plugins/plugin-consent-preview'
import type { PluginService } from './plugin-service'
import { previewPluginConsent } from './plugin-skill-consent-preview'

const PREVIEW_UNAVAILABLE = {
  ok: false,
  error: 'plugin consent preview unavailable'
} as const

type PreviewLoader = (
  service: PluginService,
  request: PluginConsentPreviewRequest,
  signal?: AbortSignal
) => Promise<PluginConsentPreviewResult>

type InFlightPreview = {
  controller: AbortController
  consumers: Set<symbol>
  promise: Promise<PluginConsentPreviewResult>
}

type PreviewClient = {
  ownerKey: string
  signal?: AbortSignal
}

function previewIdentity(
  service: PluginService,
  request: PluginConsentPreviewRequest
): string | null {
  const plugin = service.findValidPlugin(request.pluginKey)
  if (!plugin || plugin.consentFingerprint !== request.reviewedFingerprint) {
    return null
  }
  return JSON.stringify([
    plugin.pluginKey,
    plugin.rootDir,
    plugin.contentHash,
    plugin.consentFingerprint
  ])
}

function waitForPreview(
  promise: Promise<PluginConsentPreviewResult>,
  signal?: AbortSignal
): Promise<PluginConsentPreviewResult> {
  if (!signal) {
    return promise
  }
  if (signal.aborted) {
    return Promise.resolve(PREVIEW_UNAVAILABLE)
  }
  return new Promise((resolve) => {
    let settled = false
    const finish = (result: PluginConsentPreviewResult): void => {
      if (settled) {
        return
      }
      settled = true
      signal.removeEventListener('abort', onAbort)
      resolve(result)
    }
    const onAbort = (): void => finish(PREVIEW_UNAVAILABLE)
    signal.addEventListener('abort', onAbort, { once: true })
    void promise.then(finish, () => finish(PREVIEW_UNAVAILABLE))
  })
}

export class PluginConsentPreviewController {
  private readonly inFlight = new Map<string, InFlightPreview>()
  private readonly cache = new Map<string, Extract<PluginConsentPreviewResult, { ok: true }>>()
  private readonly activeOwners = new Set<string>()
  private activeLoads = 0

  constructor(
    private readonly loader: PreviewLoader = previewPluginConsent,
    private readonly maxConcurrentLoads = 2,
    private readonly maxCachedPreviews = 8
  ) {}

  async preview(
    service: PluginService,
    request: PluginConsentPreviewRequest,
    client: PreviewClient
  ): Promise<PluginConsentPreviewResult> {
    const identity = previewIdentity(service, request)
    if (!identity || client.signal?.aborted || this.activeOwners.has(client.ownerKey)) {
      return PREVIEW_UNAVAILABLE
    }
    this.activeOwners.add(client.ownerKey)
    try {
      const cached = this.cache.get(identity)
      if (cached) {
        return cached
      }
      let record = this.inFlight.get(identity)
      if (!record) {
        if (this.activeLoads >= this.maxConcurrentLoads) {
          return PREVIEW_UNAVAILABLE
        }
        record = this.startLoad(service, request, identity)
      }
      const consumer = Symbol(client.ownerKey)
      record.consumers.add(consumer)
      try {
        return await waitForPreview(record.promise, client.signal)
      } finally {
        record.consumers.delete(consumer)
        if (record.consumers.size === 0) {
          record.controller.abort()
        }
      }
    } finally {
      this.activeOwners.delete(client.ownerKey)
    }
  }

  private startLoad(
    service: PluginService,
    request: PluginConsentPreviewRequest,
    identity: string
  ): InFlightPreview {
    const record: InFlightPreview = {
      controller: new AbortController(),
      consumers: new Set(),
      promise: Promise.resolve(PREVIEW_UNAVAILABLE)
    }
    this.activeLoads += 1
    record.promise = this.loader(service, request, record.controller.signal)
      .catch(() => PREVIEW_UNAVAILABLE)
      .then((result) => {
        if (result.ok) {
          this.cache.delete(identity)
          this.cache.set(identity, result)
          while (this.cache.size > this.maxCachedPreviews) {
            this.cache.delete(this.cache.keys().next().value!)
          }
        }
        return result
      })
      .finally(() => {
        this.activeLoads -= 1
        if (this.inFlight.get(identity) === record) {
          this.inFlight.delete(identity)
        }
      })
    this.inFlight.set(identity, record)
    return record
  }
}

const controllers = new WeakMap<PluginService, PluginConsentPreviewController>()

export function previewPluginConsentForClient(
  service: PluginService,
  request: PluginConsentPreviewRequest,
  client: PreviewClient
): Promise<PluginConsentPreviewResult> {
  let controller = controllers.get(service)
  if (!controller) {
    controller = new PluginConsentPreviewController()
    controllers.set(service, controller)
  }
  return controller.preview(service, request, client)
}

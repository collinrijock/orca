import type { PluginEventName } from '../../shared/plugins/plugin-manifest'
import {
  capabilityKinds,
  type PluginCapabilityKind
} from '../../shared/plugins/plugin-capabilities'
import {
  getPluginActivationState,
  type PluginConsentLists
} from '../../shared/plugins/plugin-consent-state'
import type { PluginPanelActionOutcome } from '../../shared/plugins/plugin-panel-bridge'
import {
  createPluginExtensionRegistry,
  type PluginExtensionRegistry
} from '../../shared/plugins/plugin-extension-registry'
import {
  discoverPlugins,
  getPluginsDataDir,
  getUserPluginsDir,
  isInvalidDiscoveredPlugin,
  type DiscoveredPlugin,
  type ValidDiscoveredPlugin
} from './plugin-discovery'
import { PluginEventBus } from './plugin-event-bus'
import { PluginAuditLog } from './plugin-audit-log'
import { executePluginHostCallRequest } from './plugin-host-call-adapter'
import { PluginContentVerifier } from './plugin-content-integrity'
import { bindPluginHostServices, type PluginRuntimeDelegate } from './plugin-host-service-bindings'
import { PluginLogBuffer, type PluginLogLine } from './plugin-log-buffer'
import { PluginPanelController } from './plugin-panel-controller'
import { PluginWorkerController } from './plugin-worker-controller'
import { PluginServiceHousekeeping } from './plugin-service-housekeeping'
import { collectApprovedWorkerSpecs } from './plugin-worker-reconciliation'
import type { PluginRunState } from './plugin-supervisor'
import { isPluginApproved, snapshotPluginConsentLists } from './plugin-activation-policy'
import { PluginContentPackRegistry } from './plugin-content-pack-registry'
import type { PluginServiceOptions } from './plugin-service-options'

export type { PluginRuntimeDelegate } from './plugin-host-service-bindings'
export type { PluginLogLine } from './plugin-log-buffer'
export type { PluginServiceOptions } from './plugin-service-options'

export class PluginService {
  readonly options: PluginServiceOptions
  private readonly registry: PluginExtensionRegistry = createPluginExtensionRegistry()
  private readonly eventBus = new PluginEventBus()
  private readonly audit: PluginAuditLog
  private readonly workerController: PluginWorkerController
  private readonly logBuffer = new PluginLogBuffer()
  private readonly contentVerifier = new PluginContentVerifier()
  readonly contentPacks: PluginContentPackRegistry
  readonly panels: PluginPanelController
  private readonly changeListeners = new Set<() => void>()
  private readonly housekeeping = new PluginServiceHousekeeping()
  private discovered: DiscoveredPlugin[] = []
  private runtimeDelegate: PluginRuntimeDelegate | null = null
  private initPromise: Promise<void> | null = null
  private refreshChain: Promise<void> = Promise.resolve()
  private disposed = false

  constructor(options: PluginServiceOptions) {
    this.options = options
    this.contentPacks = new PluginContentPackRegistry(this.contentVerifier, {
      pluginsDataDir: getPluginsDataDir(options.userDataPath),
      homeDirectory: options.homeDirectory
    })
    this.audit = new PluginAuditLog(getPluginsDataDir(options.userDataPath))
    this.panels = new PluginPanelController({
      resolveApprovedPlugin: (pluginKey) => {
        const plugin = this.findValidPlugin(pluginKey)
        return plugin && this.activationState(plugin) === 'approved' ? plugin : null
      },
      contentVerifier: this.contentVerifier,
      executeHostCall: (pluginKey, method, params) =>
        this.executeHostCall(pluginKey, method, params, { viaPanel: true }),
      log: (pluginKey, line) => this.logBuffer.append(pluginKey, 'error', line)
    })
    this.workerController = new PluginWorkerController({
      entryPath: options.hostEntryPath ?? '',
      maxActive: options.maxActiveWorkers,
      idleReapMs: options.idleReapMs,
      workerFactory: options.workerFactory,
      registry: this.registry,
      contentVerifier: this.contentVerifier,
      capabilities: (pluginKey) => this.getGrantedCapabilities(pluginKey),
      isCurrentApproved: (plugin) =>
        this.findValidPlugin(plugin.pluginKey) === plugin &&
        this.activationState(plugin) === 'approved',
      invokeCommand: (pluginKey, commandId, args) => this.invokeCommand(pluginKey, commandId, args),
      executeHostCall: (pluginKey, method, params) =>
        this.executeHostCall(pluginKey, method, params, { viaPanel: false }),
      log: (pluginKey, level, line) => this.logBuffer.append(pluginKey, level, line),
      onStateChanged: () => this.notifyChanged(),
      onWorkerGone: (pluginKey) => this.eventBus.clear(pluginKey)
    })
  }

  setRuntimeDelegate(delegate: PluginRuntimeDelegate | null): void {
    this.runtimeDelegate = delegate
  }

  onChanged(listener: () => void): () => void {
    this.changeListeners.add(listener)
    return () => this.changeListeners.delete(listener)
  }

  private notifyChanged(): void {
    for (const listener of this.changeListeners) {
      listener()
    }
  }

  async initialize(): Promise<void> {
    this.initPromise ??= this.refresh()
    return this.initPromise
  }

  async whenReady(): Promise<void> {
    await (this.initPromise ?? Promise.resolve()).catch(() => undefined)
  }

  refresh(): Promise<void> {
    // Snapshot settings at request time so a quick off→on sequence still
    // processes the off transition and revokes old workers/panel sessions.
    const enabled = this.options.isPluginSystemEnabled()
    const devPaths = this.options.getDevPluginPaths()
    const consentLists = snapshotPluginConsentLists(this.options)
    const refresh = this.refreshChain.then(() =>
      this.performRefresh(enabled, devPaths, consentLists)
    )
    this.refreshChain = refresh.catch(() => undefined)
    return refresh
  }

  private async performRefresh(
    enabled: boolean,
    devPaths: string[],
    consentLists: PluginConsentLists
  ): Promise<void> {
    if (this.disposed) {
      return
    }
    this.contentVerifier.clear()
    if (!enabled) {
      this.panels.revokeAll()
    }
    const next = enabled
      ? await discoverPlugins({
          pluginsDir: getUserPluginsDir(this.options.userDataPath),
          devPluginPaths: devPaths,
          hostVersion: this.options.hostVersion
        })
      : []
    if (this.disposed) {
      return
    }
    const nextSpecs = collectApprovedWorkerSpecs(next, (plugin) =>
      isPluginApproved(enabled, plugin, consentLists)
    )
    // Publish identity before shutdown so triggers cannot restart old code.
    this.discovered = next
    await this.contentPacks.reconcile(next, (plugin) =>
      isPluginApproved(enabled, plugin, consentLists)
    )
    // Notify before slow shutdown so feature-off unmounts panels immediately.
    this.notifyChanged()
    await this.workerController.reconcile(nextSpecs)
    if (this.disposed) {
      return
    }
    this.housekeeping.sync({
      enabled,
      devPaths,
      reapIdle: () => this.workerController.reapIdle(),
      refresh: () => void this.refresh()
    })
    this.notifyChanged()
  }

  getDiscovered(): readonly DiscoveredPlugin[] {
    return this.discovered
  }

  getLogs(pluginKey: string): PluginLogLine[] {
    return this.logBuffer.get(pluginKey)
  }

  findValidPlugin(pluginKey: string): ValidDiscoveredPlugin | null {
    for (const plugin of this.discovered) {
      if (!isInvalidDiscoveredPlugin(plugin) && plugin.pluginKey === pluginKey) {
        return plugin
      }
    }
    return null
  }

  activationState(plugin: ValidDiscoveredPlugin): ReturnType<typeof getPluginActivationState> {
    // The feature flag is an authority boundary, not only a discovery hint:
    // callers fail closed immediately even before async reconciliation ends.
    if (!this.options.isPluginSystemEnabled()) {
      return 'disabled'
    }
    return getPluginActivationState(plugin.pluginKey, plugin.consentFingerprint, {
      pluginConsents: this.options.getPluginConsents(),
      disabledPlugins: this.options.getDisabledPlugins()
    })
  }

  workerState(pluginKey: string): { state: PluginRunState; restarts: number } {
    return this.workerController.state(pluginKey)
  }

  activationError(pluginKey: string): string | null {
    return this.contentPacks.error(pluginKey) ?? this.workerController.activationError(pluginKey)
  }

  /** Consented capability kinds for an approved plugin; null otherwise so
   *  callers deny uniformly (no probe-able distinction). */
  getGrantedCapabilities(pluginKey: string): PluginCapabilityKind[] | null {
    const plugin = this.findValidPlugin(pluginKey)
    if (!plugin || this.activationState(plugin) !== 'approved') {
      return null
    }
    return capabilityKinds(plugin.manifest.capabilities)
  }

  /** Host API chokepoint for both transports (worker fork IPC + panel
   *  bridge); serve RPC reuses it through the same entry points. */
  async executeHostCall(
    pluginKey: string,
    method: string,
    params: unknown,
    options: { viaPanel: boolean }
  ): Promise<PluginPanelActionOutcome> {
    return executePluginHostCallRequest({
      pluginKey,
      request: { method, params },
      viaPanel: options.viaPanel,
      resolvePolicy: (boundPluginKey) => ({
        grantedCapabilities: this.getGrantedCapabilities(boundPluginKey),
        services: this.runtimeDelegate
          ? bindPluginHostServices({
              delegate: this.runtimeDelegate,
              pluginsDataDir: getPluginsDataDir(this.options.userDataPath),
              subscribeEvents: (key, events) => this.eventBus.subscribe(key, events)
            })
          : null,
        audit: this.audit
      })
    })
  }

  async invokeCommand(pluginKey: string, commandId: string, args?: unknown): Promise<unknown> {
    const plugin = this.findValidPlugin(pluginKey)
    if (!plugin || this.activationState(plugin) !== 'approved') {
      throw new Error(`plugin ${pluginKey} is not enabled`)
    }
    if (!plugin.manifest.contributes.commands.some((command) => command.id === commandId)) {
      throw new Error(`plugin ${pluginKey} does not contribute command ${commandId}`)
    }
    const handle = await this.workerController.ensure(plugin)
    if (!handle.commands.includes(commandId)) {
      throw new Error(`plugin ${pluginKey} registered no handler for ${commandId}`)
    }
    return handle.invokeCommand(commandId, args)
  }

  emitEvent(event: PluginEventName, payload: unknown): void {
    if (!this.options.isPluginSystemEnabled() || this.disposed) {
      return
    }
    const projected = this.eventBus.projectPayload(event, payload)
    if (!projected.ok) {
      return
    }
    for (const plugin of this.discovered) {
      if (isInvalidDiscoveredPlugin(plugin) || this.activationState(plugin) !== 'approved') {
        continue
      }
      const manifestSubscribed = plugin.manifest.contributes.events.some(
        (subscription) => subscription.on === event
      )
      if (manifestSubscribed && plugin.manifest.main) {
        void this.workerController
          .ensure(plugin)
          .then((handle) => handle.deliverEvent(event, projected.payload))
          .catch((error) => {
            this.logBuffer.append(
              plugin.pluginKey,
              'warn',
              `event ${event} dropped: ${error instanceof Error ? error.message : String(error)}`
            )
          })
      } else if (this.eventBus.isDynamicallySubscribed(plugin.pluginKey, event)) {
        this.workerController.deliverEventIfRunning(plugin.pluginKey, event, projected.payload)
      }
    }
  }

  async deactivatePlugin(pluginKey: string): Promise<void> {
    await this.workerController.deactivate(pluginKey)
    this.notifyChanged()
  }

  /** Reconciles live workers and client projections after consent or
   * enablement changes without re-reading plugin files or starting workers. */
  async reconcileActivationState(): Promise<void> {
    await this.contentPacks.reconcile(this.discovered, (plugin) => {
      return this.activationState(plugin) === 'approved'
    })
    const nextSpecs = collectApprovedWorkerSpecs(
      this.discovered,
      (plugin) => this.activationState(plugin) === 'approved'
    )
    await this.workerController.reconcile(nextSpecs)
    this.notifyChanged()
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.housekeeping.dispose()
    this.panels.dispose()
    await this.refreshChain.catch(() => undefined)
    await this.workerController.dispose()
    await this.audit.flush()
  }
}

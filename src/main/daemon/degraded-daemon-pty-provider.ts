import type { DaemonPtyAdapter } from './daemon-pty-adapter'
import type { DaemonGenerationDiscovery } from './daemon-generation-inventory'
import { DegradedDaemonProviderEvents } from './degraded-daemon-provider-events'
import { shutdownDegradedFallbackSessions } from './degraded-daemon-fallback-shutdown'
import type { DegradedFallbackShutdownResult } from './degraded-daemon-fallback-shutdown'
import {
  DegradedDaemonSessionRoutes,
  type ManagedDegradedPtyProvider
} from './degraded-daemon-session-routes'
import type {
  IPtyProvider,
  PtyBackgroundStreamEvent,
  PtyProviderBufferSnapshot,
  PtyProcessInfo,
  PtySpawnOptions,
  PtySpawnResult
} from '../providers/types'
import type { PtyExitPayload } from '../providers/pty-exit-payload'
import type { TerminalBindingProvenance } from '../../shared/daemon-session-ownership'

export class DegradedDaemonPtyProvider implements IPtyProvider {
  readonly routesFreshSpawnsToLocalProvider = true
  // Why: the preserved daemon answers protocol but cannot spawn fresh PTYs.
  // Surfaced (e.g. via pty:management:listSessions) so the UI can warn that
  // new terminals are running without daemon persistence until a restart.
  readonly isDegraded = true

  private current: DaemonPtyAdapter
  private legacy: DaemonPtyAdapter[]
  private fallback: ManagedDegradedPtyProvider
  private sessionRoutes: DegradedDaemonSessionRoutes
  private providerEvents: DegradedDaemonProviderEvents
  private restartFenced = false
  private createOrAttachInFlight = 0
  private createOrAttachDrainWaiters = new Set<() => void>()

  constructor(opts: {
    current: DaemonPtyAdapter
    legacy: DaemonPtyAdapter[]
    fallback: ManagedDegradedPtyProvider
  }) {
    this.current = opts.current
    this.legacy = opts.legacy
    this.fallback = opts.fallback
    this.sessionRoutes = new DegradedDaemonSessionRoutes(this.fallback, () =>
      this.allDaemonAdapters()
    )
    this.providerEvents = new DegradedDaemonProviderEvents(this.allProviders())
  }

  async discoverDaemonSessions(): Promise<DaemonGenerationDiscovery> {
    const generations: DaemonGenerationDiscovery['generations'] = []
    const failedProtocols: number[] = []
    for (const adapter of this.allDaemonAdapters()) {
      try {
        const sessions = await adapter.listSessions()
        for (const session of sessions) {
          this.sessionRoutes.record(session.sessionId, adapter)
        }
        generations.push({ adapter, protocolVersion: adapter.protocolVersion, sessions })
      } catch (error) {
        failedProtocols.push(adapter.protocolVersion)
        console.warn('[daemon] Failed to discover degraded daemon sessions', error)
      }
    }
    return { generations, failedProtocols }
  }

  async spawn(opts: PtySpawnOptions): Promise<PtySpawnResult> {
    return this.withCreateOrAttachAdmission(async () => {
      const mapped = opts.sessionId
        ? this.sessionRoutes.mutableMap().get(opts.sessionId)
        : undefined
      const target = mapped ?? this.fallback
      const result = await target.spawn(opts)
      this.sessionRoutes.record(result.id, target)
      return result
    })
  }

  getPtyBindingProvenance(
    id: string
  ): { kind: 'local-daemon'; protocolVersion: number } | { kind: 'local-fallback' } {
    const provider = this.sessionRoutes.providerFor(id)
    if (provider === this.fallback) {
      return { kind: 'local-fallback' }
    }
    return (provider as DaemonPtyAdapter).getPtyBindingProvenance()
  }

  forgetPtyRouteAfterVerifiedStop(id: string, expected?: TerminalBindingProvenance): boolean {
    return this.sessionRoutes.forgetAfterVerifiedStop(id, expected)
  }

  async listProcessesForBinding(provenance: TerminalBindingProvenance): Promise<PtyProcessInfo[]> {
    const provider = this.sessionRoutes.providerForBinding(provenance)
    const processes = await provider.listProcesses()
    for (const process of processes) {
      this.sessionRoutes.record(process.id, provider)
    }
    return processes
  }

  async attach(id: string): Promise<void> {
    await this.withCreateOrAttachAdmission(() => this.sessionRoutes.providerFor(id).attach(id))
  }

  hasPty(id: string): boolean {
    return this.sessionRoutes.hasPty(id)
  }

  write(id: string, data: string): void {
    this.sessionRoutes.providerFor(id).write(id, data)
  }

  resize(id: string, cols: number, rows: number): void {
    this.sessionRoutes.providerFor(id).resize(id, cols, rows)
  }

  pauseProducer(id: string): void {
    this.sessionRoutes.providerFor(id).pauseProducer?.(id)
  }

  resumeProducer(id: string): void {
    this.sessionRoutes.providerFor(id).resumeProducer?.(id)
  }

  setPtyBackgrounded(id: string, background: boolean): void {
    this.sessionRoutes.providerFor(id).setPtyBackgrounded?.(id, background)
  }

  async shutdown(id: string, opts: { immediate?: boolean; keepHistory?: boolean }): Promise<void> {
    await this.sessionRoutes.providerFor(id).shutdown(id, opts)
    // Why: retain physical provenance until the caller verifies absence with a healthy listing.
  }

  async sendSignal(id: string, signal: string): Promise<void> {
    await this.sessionRoutes.providerFor(id).sendSignal(id, signal)
  }

  async getCwd(id: string): Promise<string> {
    return this.sessionRoutes.providerFor(id).getCwd(id)
  }

  async getInitialCwd(id: string): Promise<string> {
    return this.sessionRoutes.providerFor(id).getInitialCwd(id)
  }

  async getAppliedSize(id: string): Promise<{ cols: number; rows: number } | null> {
    return (await this.sessionRoutes.providerFor(id).getAppliedSize?.(id)) ?? null
  }

  async getBufferSnapshot(
    id: string,
    opts?: { scrollbackRows?: number }
  ): Promise<PtyProviderBufferSnapshot | null> {
    // Why: a preserved legacy daemon can still thin its monitoring stream;
    // recovery must reach the adapter that owns that session's full model.
    return (await this.sessionRoutes.providerFor(id).getBufferSnapshot?.(id, opts)) ?? null
  }

  async clearBuffer(id: string): Promise<void> {
    await this.sessionRoutes.providerFor(id).clearBuffer(id)
  }

  acknowledgeDataEvent(id: string, charCount: number): void {
    this.sessionRoutes.providerFor(id).acknowledgeDataEvent(id, charCount)
  }

  async hasChildProcesses(id: string): Promise<boolean> {
    return this.sessionRoutes.providerFor(id).hasChildProcesses(id)
  }

  async getForegroundProcess(id: string): Promise<string | null> {
    return this.sessionRoutes.providerFor(id).getForegroundProcess(id)
  }

  async confirmForegroundProcess(id: string): Promise<string | null> {
    return this.sessionRoutes.providerFor(id).confirmForegroundProcess?.(id) ?? null
  }

  async serialize(ids: string[]): Promise<string> {
    return this.fallback.serialize(ids)
  }

  async revive(state: string): Promise<void> {
    await this.fallback.revive(state)
  }

  async listProcesses(): Promise<PtyProcessInfo[]> {
    const results = await Promise.all(
      this.allProviders().map((provider) => provider.listProcesses())
    )
    return results.flat()
  }

  async getDefaultShell(): Promise<string> {
    return this.fallback.getDefaultShell()
  }

  async getProfiles(): Promise<{ name: string; path: string }[]> {
    return this.fallback.getProfiles()
  }

  onData(
    callback: (payload: { id: string; data: string; sequenceChars?: number }) => void
  ): () => void {
    return this.providerEvents.onData(callback)
  }

  onBackgroundStreamEvent(callback: (payload: PtyBackgroundStreamEvent) => void): () => void {
    return this.providerEvents.onBackgroundStreamEvent(callback)
  }

  onReplay(callback: (payload: { id: string; data: string }) => void): () => void {
    return this.providerEvents.onReplay(callback)
  }

  onExit(callback: (payload: PtyExitPayload) => void): () => void {
    return this.providerEvents.onExit(callback)
  }

  onPtyBindingInventoryAvailable(
    callback: (provenance: TerminalBindingProvenance) => void
  ): () => void {
    return this.providerEvents.onPtyBindingInventoryAvailable(callback)
  }

  ackColdRestore(sessionId: string): void {
    this.daemonAdapterFor(sessionId)?.ackColdRestore(sessionId)
  }

  clearTombstone(sessionId: string): void {
    this.daemonAdapterFor(sessionId)?.clearTombstone(sessionId)
  }

  async reconcileOnStartup(validWorktreeIds: Set<string>): Promise<{
    alive: string[]
    killed: string[]
  }> {
    const alive: string[] = []
    const killed: string[] = []
    for (const adapter of this.allDaemonAdapters()) {
      const result = await adapter.reconcileOnStartup(validWorktreeIds)
      for (const id of result.alive) {
        alive.push(id)
        this.sessionRoutes.record(id, adapter)
      }
      for (const id of result.killed) {
        killed.push(id)
        this.sessionRoutes.delete(id)
      }
    }
    return { alive, killed }
  }

  dispose(): void {
    this.disposeProviderOnly()
    for (const adapter of this.allDaemonAdapters()) {
      adapter.dispose()
    }
  }

  disposeProviderOnly(): void {
    this.providerEvents.dispose()
  }

  async shutdownFallbackSessions(): Promise<DegradedFallbackShutdownResult> {
    return shutdownDegradedFallbackSessions(this.sessionRoutes.mutableMap(), this.fallback)
  }

  async beginRestartFence(): Promise<string[]> {
    this.restartFenced = true
    if (this.createOrAttachInFlight > 0) {
      await new Promise<void>((resolve) => this.createOrAttachDrainWaiters.add(resolve))
    }
    return this.current.beginRestartFence()
  }

  cancelRestartFence(): void {
    this.restartFenced = false
    this.current.cancelRestartFence()
  }

  getCurrentDaemonSessionIds(): string[] {
    return this.sessionRoutes.sessionIdsFor(this.current)
  }

  private async withCreateOrAttachAdmission<T>(operation: () => Promise<T>): Promise<T> {
    if (this.restartFenced) {
      throw new Error('Daemon restart in progress')
    }
    this.createOrAttachInFlight += 1
    try {
      return await operation()
    } finally {
      this.createOrAttachInFlight -= 1
      if (this.createOrAttachInFlight === 0) {
        for (const resolve of this.createOrAttachDrainWaiters) {
          resolve()
        }
        this.createOrAttachDrainWaiters.clear()
      }
    }
  }

  fanoutCurrentDaemonSyntheticExits(code: number): void {
    for (const id of this.getCurrentDaemonSessionIds()) {
      // Why: sessions discovered from listProcesses may not exist in the
      // adapter's active-session set; keep its route until verified-exit cleanup.
      this.providerEvents.fanoutSyntheticExit(
        id,
        code,
        this.current.getPtyBindingProvenance?.() ?? {
          kind: 'local-daemon',
          protocolVersion: this.current.protocolVersion
        }
      )
    }
  }

  async disconnectOnly(): Promise<void> {
    this.disposeProviderOnly()
    await Promise.all(this.allDaemonAdapters().map((adapter) => adapter.disconnectOnly()))
  }

  getCurrentAdapter(): DaemonPtyAdapter {
    return this.current
  }

  getLegacyAdapters(): readonly DaemonPtyAdapter[] {
    return this.legacy
  }

  getAllAdapters(): readonly DaemonPtyAdapter[] {
    return this.allDaemonAdapters()
  }

  private daemonAdapterFor(sessionId: string): DaemonPtyAdapter | null {
    return this.sessionRoutes.daemonAdapterFor(sessionId)
  }

  private allProviders(): ManagedDegradedPtyProvider[] {
    return [this.fallback, ...this.allDaemonAdapters()]
  }

  private allDaemonAdapters(): DaemonPtyAdapter[] {
    return [this.current, ...this.legacy]
  }
}

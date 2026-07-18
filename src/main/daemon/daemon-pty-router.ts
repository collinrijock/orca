import type { DaemonPtyAdapter } from './daemon-pty-adapter'
import type { DaemonGenerationDiscovery } from './daemon-generation-inventory'
import type {
  IPtyProvider,
  PtyBackgroundStreamEvent,
  PtyDataPayload,
  PtyProviderBufferSnapshot,
  PtyProcessInfo,
  PtySpawnOptions,
  PtySpawnResult
} from '../providers/types'
import type { PtyExitPayload } from '../providers/pty-exit-payload'
import type { TerminalBindingProvenance } from '../../shared/daemon-session-ownership'

export class DaemonPtyRouter implements IPtyProvider {
  private current: DaemonPtyAdapter
  private legacy: DaemonPtyAdapter[]
  private sessionAdapters = new Map<string, DaemonPtyAdapter>()
  private unsubscribers: (() => void)[] = []
  private dataListeners: ((payload: PtyDataPayload) => void)[] = []
  private exitListeners: ((payload: PtyExitPayload) => void)[] = []
  private bindingInventoryListeners: ((provenance: TerminalBindingProvenance) => void)[] = []

  constructor(opts: { current: DaemonPtyAdapter; legacy: DaemonPtyAdapter[] }) {
    this.current = opts.current
    this.legacy = opts.legacy

    for (const adapter of this.allAdapters()) {
      this.unsubscribers.push(
        adapter.onData((payload) => {
          for (const listener of this.dataListeners) {
            listener(payload)
          }
        }),
        adapter.onExit((payload) => {
          // Why: legacy exits carry no incarnation. Keep the exact adapter route until a
          // healthy identity-matched re-list proves this session was not replaced.
          for (const listener of this.exitListeners) {
            listener({ ...payload, provenance: adapter.getPtyBindingProvenance() })
          }
        }),
        adapter.onPtyBindingInventoryAvailable?.((provenance) => {
          for (const listener of this.bindingInventoryListeners.slice()) {
            listener(provenance)
          }
        }) ?? (() => {})
      )
    }
  }

  async discoverLegacySessions(): Promise<DaemonGenerationDiscovery> {
    return await this.discoverAdapters(this.legacy)
  }

  async discoverDaemonSessions(): Promise<DaemonGenerationDiscovery> {
    return await this.discoverAdapters(this.allAdapters())
  }

  private async discoverAdapters(
    adapters: readonly DaemonPtyAdapter[]
  ): Promise<DaemonGenerationDiscovery> {
    const generations: DaemonGenerationDiscovery['generations'] = []
    const failedProtocols: number[] = []
    for (const adapter of adapters) {
      try {
        const sessions = await adapter.listSessions()
        for (const session of sessions) {
          this.sessionAdapters.set(session.sessionId, adapter)
        }
        generations.push({ adapter, protocolVersion: adapter.protocolVersion, sessions })
      } catch (error) {
        failedProtocols.push(adapter.protocolVersion)
        console.warn('[daemon] Failed to discover legacy daemon sessions', error)
      }
    }
    return { generations, failedProtocols }
  }

  async spawn(opts: PtySpawnOptions): Promise<PtySpawnResult> {
    const target =
      (opts.sessionId ? this.sessionAdapters.get(opts.sessionId) : undefined) ?? this.current
    const result = await target.spawn(opts)
    this.sessionAdapters.set(result.id, target)
    return result
  }

  supportsGitCredentialGuardHost(sessionId?: string): boolean {
    return (sessionId ? this.adapterFor(sessionId) : this.current).supportsGitCredentialGuardHost()
  }

  getPtyBindingProvenance(id: string): TerminalBindingProvenance {
    return this.adapterFor(id).getPtyBindingProvenance()
  }

  forgetPtyRouteAfterVerifiedStop(id: string, expected?: TerminalBindingProvenance): boolean {
    const routed = this.sessionAdapters.get(id)
    if (
      routed &&
      expected &&
      JSON.stringify(routed.getPtyBindingProvenance()) !== JSON.stringify(expected)
    ) {
      return false
    }
    this.sessionAdapters.delete(id)
    return true
  }

  async listProcessesForBinding(provenance: TerminalBindingProvenance): Promise<PtyProcessInfo[]> {
    const adapter = this.adapterForBinding(provenance)
    const processes = await adapter.listProcesses()
    for (const process of processes) {
      this.sessionAdapters.set(process.id, adapter)
    }
    return processes
  }

  async attach(id: string): Promise<void> {
    await this.adapterFor(id).attach(id)
  }

  hasPty(id: string): boolean {
    const routed = this.sessionAdapters.get(id)
    if (routed) {
      return routed.hasPty(id)
    }
    return this.current.hasPty(id) || this.legacy.some((adapter) => adapter.hasPty(id))
  }

  write(id: string, data: string): void {
    this.adapterFor(id).write(id, data)
  }

  resize(id: string, cols: number, rows: number): void {
    this.adapterFor(id).resize(id, cols, rows)
  }

  pauseProducer(id: string): void {
    this.adapterFor(id).pauseProducer(id)
  }

  resumeProducer(id: string): void {
    this.adapterFor(id).resumeProducer(id)
  }

  setPtyBackgrounded(id: string, background: boolean): void {
    this.adapterFor(id).setPtyBackgrounded(id, background)
  }

  async shutdown(id: string, opts: { immediate?: boolean; keepHistory?: boolean }): Promise<void> {
    await this.adapterFor(id).shutdown(id, opts)
    // Why: neither an exit event nor a successful shutdown RPC carries incarnation proof.
    // The caller drops this route only after a healthy re-list confirms absence.
  }

  async sendSignal(id: string, signal: string): Promise<void> {
    await this.adapterFor(id).sendSignal(id, signal)
  }

  async getCwd(id: string): Promise<string> {
    return this.adapterFor(id).getCwd(id)
  }

  async getInitialCwd(id: string): Promise<string> {
    return this.adapterFor(id).getInitialCwd(id)
  }

  async getAppliedSize(id: string): Promise<{ cols: number; rows: number } | null> {
    return (await this.adapterFor(id).getAppliedSize?.(id)) ?? null
  }

  async getBufferSnapshot(
    id: string,
    opts?: { scrollbackRows?: number }
  ): Promise<PtyProviderBufferSnapshot | null> {
    return await this.adapterFor(id).getBufferSnapshot(id, opts)
  }

  canProvideAuthoritativeBufferSnapshot(id: string): boolean {
    return this.adapterFor(id).canProvideAuthoritativeBufferSnapshot(id)
  }

  async clearBuffer(id: string): Promise<void> {
    await this.adapterFor(id).clearBuffer(id)
  }

  acknowledgeDataEvent(id: string, charCount: number): void {
    this.adapterFor(id).acknowledgeDataEvent(id, charCount)
  }

  async hasChildProcesses(id: string): Promise<boolean> {
    return this.adapterFor(id).hasChildProcesses(id)
  }

  async getForegroundProcess(id: string): Promise<string | null> {
    return this.adapterFor(id).getForegroundProcess(id)
  }

  async confirmForegroundProcess(id: string): Promise<string | null> {
    return this.adapterFor(id).confirmForegroundProcess(id)
  }

  async serialize(ids: string[]): Promise<string> {
    return this.current.serialize(ids)
  }

  async revive(state: string): Promise<void> {
    await this.current.revive(state)
  }

  async listProcesses(): Promise<PtyProcessInfo[]> {
    // Why: runtime exact-stop/liveness flows must fail closed if any adapter
    // cannot provide a trustworthy process list.
    const results = await Promise.all(this.allAdapters().map((adapter) => adapter.listProcesses()))
    return results.flat()
  }

  async getDefaultShell(): Promise<string> {
    return this.current.getDefaultShell()
  }

  async getProfiles(): Promise<{ name: string; path: string }[]> {
    return this.current.getProfiles()
  }

  onData(callback: (payload: PtyDataPayload) => void): () => void {
    this.dataListeners.push(callback)
    return () => {
      const idx = this.dataListeners.indexOf(callback)
      if (idx !== -1) {
        this.dataListeners.splice(idx, 1)
      }
    }
  }

  onBackgroundStreamEvent(callback: (payload: PtyBackgroundStreamEvent) => void): () => void {
    const unsubscribes = this.allAdapters().map((adapter) =>
      adapter.onBackgroundStreamEvent(callback)
    )
    return () => {
      for (const unsubscribe of unsubscribes) {
        unsubscribe()
      }
    }
  }

  onReplay(_callback: (payload: { id: string; data: string }) => void): () => void {
    return () => {}
  }

  onExit(callback: (payload: PtyExitPayload) => void): () => void {
    this.exitListeners.push(callback)
    return () => {
      const idx = this.exitListeners.indexOf(callback)
      if (idx !== -1) {
        this.exitListeners.splice(idx, 1)
      }
    }
  }

  onPtyBindingInventoryAvailable(
    callback: (provenance: TerminalBindingProvenance) => void
  ): () => void {
    this.bindingInventoryListeners.push(callback)
    return () => {
      const index = this.bindingInventoryListeners.indexOf(callback)
      if (index !== -1) {
        this.bindingInventoryListeners.splice(index, 1)
      }
    }
  }

  ackColdRestore(sessionId: string): void {
    this.adapterFor(sessionId).ackColdRestore(sessionId)
  }

  clearTombstone(sessionId: string): void {
    this.adapterFor(sessionId).clearTombstone(sessionId)
  }

  async reconcileOnStartup(validWorktreeIds: Set<string>): Promise<{
    alive: string[]
    killed: string[]
  }> {
    const alive: string[] = []
    const killed: string[] = []
    for (const adapter of this.allAdapters()) {
      const result = await adapter.reconcileOnStartup(validWorktreeIds)
      // Why: daemon startup can reconcile many restored sessions; spreading
      // those arrays into push can exceed JavaScript's argument limit.
      for (const id of result.alive) {
        alive.push(id)
      }
      for (const id of result.killed) {
        killed.push(id)
      }
      for (const id of result.alive) {
        this.sessionAdapters.set(id, adapter)
      }
      for (const id of result.killed) {
        this.sessionAdapters.delete(id)
      }
    }
    return { alive, killed }
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribers.splice(0)) {
      unsubscribe()
    }
    for (const adapter of this.allAdapters()) {
      adapter.dispose()
    }
  }

  // Why: restart reuses legacy adapters, so detach only this router's listeners;
  // disposing adapters would kill sessions, while retaining listeners leaks routers.
  disposeRouterOnly(): void {
    for (const unsubscribe of this.unsubscribers.splice(0)) {
      unsubscribe()
    }
  }

  async disconnectOnly(): Promise<void> {
    for (const unsubscribe of this.unsubscribers.splice(0)) {
      unsubscribe()
    }
    await Promise.all([...this.allAdapters()].map((adapter) => adapter.disconnectOnly()))
  }

  // Why: the Manage Sessions panel iterates all adapters to list sessions
  // across every protocol version, and the restart handler needs to preserve
  // surviving legacy adapters across the current-adapter swap. On this branch
  // (pre-#1323) the legacy list is set once at construction and never mutated,
  // so returning the internal array by reference is safe for the intended
  // read-only use.
  readonly getCurrentAdapter = (): DaemonPtyAdapter => this.current

  getLegacyAdapters(): readonly DaemonPtyAdapter[] {
    return this.legacy
  }

  getAllAdapters(): readonly DaemonPtyAdapter[] {
    return this.allAdapters()
  }

  private adapterFor(sessionId: string): DaemonPtyAdapter {
    return this.sessionAdapters.get(sessionId) ?? this.current
  }

  private adapterForBinding(provenance: TerminalBindingProvenance): DaemonPtyAdapter {
    if (provenance.kind !== 'local-daemon') {
      throw new Error('Binding is not owned by a daemon adapter')
    }
    const adapter = this.allAdapters().find(
      (candidate) => candidate.protocolVersion === provenance.protocolVersion
    )
    if (!adapter) {
      throw new Error(`Daemon protocol ${provenance.protocolVersion} is not routed`)
    }
    return adapter
  }

  private allAdapters(): DaemonPtyAdapter[] {
    return [this.current, ...this.legacy]
  }
}

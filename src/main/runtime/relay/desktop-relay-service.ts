import type { OrcaCloudAuthConfig } from '../../orca-profiles/profile-cloud-auth-config'
import type { OrcaRuntimeRpcServer } from '../runtime-rpc'
import { readRelayAuthContext } from './relay-auth-context'
import { RelayAuthCoordinator } from './relay-auth-coordinator'
import { RelaySessionBroker, type RelayBrokerStatus } from './relay-session-broker'
import type { PairingRelay } from '../../../shared/mobile-relay-pairing-offer'
import type {
  RelayRevokeOutbox,
  RelayDeviceBinding,
  RelayRevokeOutboxItem
} from './relay-revoke-outbox'

type DesktopRelayServiceOptions = {
  authConfig: OrcaCloudAuthConfig
  userDataPath: string
  appVersion: string
  runtimeRpc: OrcaRuntimeRpcServer
  onStatus: (status: RelayBrokerStatus) => void
}

export class DesktopRelayService {
  private readonly coordinator: RelayAuthCoordinator
  private readonly revokeOutbox: RelayRevokeOutbox

  constructor(options: DesktopRelayServiceOptions) {
    const keypair = options.runtimeRpc.getE2EEKeypair()
    const mobileSocketWiring = options.runtimeRpc.getMobileSocketWiring()
    if (!keypair || !mobileSocketWiring) {
      throw new Error('mobile_runtime_not_ready')
    }
    this.revokeOutbox = options.runtimeRpc.getRelayRevokeOutbox()
    this.coordinator = new RelayAuthCoordinator({
      readContext: () => readRelayAuthContext(options.authConfig, options.userDataPath),
      openBroker: async ({ context, isCurrent, refreshAccessToken }) => {
        const broker = await RelaySessionBroker.connect({
          authConfig: options.authConfig,
          accessToken: context.accessToken,
          identity: context.identity,
          keypair,
          appVersion: options.appVersion,
          mobileSocketWiring,
          isCurrent,
          refreshAccessToken,
          onStatus: options.onStatus,
          onResolveDirector: () => this.coordinator.restart()
        })
        void this.flushRevokeOutbox(broker)
        return broker
      },
      onStatus: options.onStatus
    })
  }

  start(): void {
    this.coordinator.reconcile()
  }

  authMutated(): void {
    this.coordinator.reconcile()
  }

  fenceAndCloseNow(): void {
    this.coordinator.fenceAndCloseNow()
  }

  async createPairingRelay(
    relayDeviceId: string
  ): Promise<{ relay: PairingRelay; binding: RelayDeviceBinding }> {
    const broker = this.coordinator.getActiveBroker()
    if (!(broker instanceof RelaySessionBroker)) {
      throw new Error('relay_control_not_active')
    }
    return {
      relay: await broker.createPairingRelay(relayDeviceId),
      binding: {
        relayHostId: broker.hostId,
        relayDeviceId,
        ownerIdentityKey: broker.ownerIdentityKey
      }
    }
  }

  onDeviceRevokeQueued(item: RelayRevokeOutboxItem): void {
    const broker = this.coordinator.getActiveBroker()
    if (
      broker instanceof RelaySessionBroker &&
      broker.hostId === item.relayHostId &&
      broker.ownerIdentityKey === item.ownerIdentityKey
    ) {
      void this.flushRevoke(broker, item)
    }
  }

  stop(): void {
    this.coordinator.stop()
  }

  private async flushRevokeOutbox(broker: RelaySessionBroker): Promise<void> {
    for (const item of this.revokeOutbox.pendingFor(broker.ownerIdentityKey, broker.hostId)) {
      await this.flushRevoke(broker, item)
    }
  }

  private async flushRevoke(
    broker: RelaySessionBroker,
    item: RelayRevokeOutboxItem
  ): Promise<void> {
    try {
      await broker.revokeDevice(item.relayDeviceId, item.reqId)
      this.revokeOutbox.remove(item.reqId)
    } catch {
      // Why: the durable item is the source of truth; reconnecting the same
      // account/control retries this stable reqId without delaying local revoke.
    }
  }
}

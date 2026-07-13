import type { OrcaCloudAuthConfig } from '../../orca-profiles/profile-cloud-auth-config'
import type { OrcaRuntimeRpcServer } from '../runtime-rpc'
import { readRelayAuthContext } from './relay-auth-context'
import { RelayAuthCoordinator } from './relay-auth-coordinator'
import { RelaySessionBroker, type RelayBrokerStatus } from './relay-session-broker'

type DesktopRelayServiceOptions = {
  authConfig: OrcaCloudAuthConfig
  userDataPath: string
  appVersion: string
  runtimeRpc: OrcaRuntimeRpcServer
  onStatus: (status: RelayBrokerStatus) => void
}

export class DesktopRelayService {
  private readonly coordinator: RelayAuthCoordinator

  constructor(options: DesktopRelayServiceOptions) {
    const keypair = options.runtimeRpc.getE2EEKeypair()
    const mobileSocketWiring = options.runtimeRpc.getMobileSocketWiring()
    if (!keypair || !mobileSocketWiring) {
      throw new Error('mobile_runtime_not_ready')
    }
    this.coordinator = new RelayAuthCoordinator({
      readContext: () => readRelayAuthContext(options.authConfig, options.userDataPath),
      openBroker: ({ context, isCurrent, refreshAccessToken }) =>
        RelaySessionBroker.connect({
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
        }),
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

  stop(): void {
    this.coordinator.stop()
  }
}

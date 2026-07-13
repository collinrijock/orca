import type WebSocket from 'ws'
import type { OrcaCloudAuthConfig } from '../../orca-profiles/profile-cloud-auth-config'
import type { PairingRelay } from '../../../shared/mobile-relay-pairing-offer'
import type {
  DeviceCredentialInstalled,
  DeviceCredentialInstallStatusResult,
  DeviceResumeConfirmed,
  MobileRelayEndpoint,
  PairingProvisionRelayParams
} from '../../../shared/mobile-relay-credential-contract'
import type { E2EEKeypair } from '../e2ee-keypair'
import type { MobileSocketWiring } from '../rpc/mobile-socket-wiring'
import { CloudRelayTransport } from '../rpc/relay-transport'
import { RelayControlClient } from './relay-control-client'
import type { DeviceCredentialInstallAuthorization } from './relay-control-requests'
import {
  deriveRelayHostId,
  exchangeRelayAuthorization,
  requestRelayAssignment,
  type RelayAuthorization,
  type RelayAssignment
} from './relay-http-client'

export type RelayBrokerStatus = 'connecting' | 'registered' | 'draining' | 'offline'

type RelayIdentity = {
  userId: string
  profileId: string
  organizationId: string
}

type RelaySessionBrokerOptions = {
  authConfig: OrcaCloudAuthConfig
  accessToken: string
  identity: RelayIdentity
  keypair: E2EEKeypair
  appVersion: string
  mobileSocketWiring: MobileSocketWiring
  isCurrent: () => boolean
  refreshAccessToken: () => Promise<string | null>
  onStatus: (status: RelayBrokerStatus) => void
  onResolveDirector: () => void
  fetch?: typeof globalThis.fetch
  createControlSocket?: (url: string, relayJwt: string) => WebSocket
  createDataSocket?: (url: string) => WebSocket
  random?: () => number
  now?: () => number
}

export class StaleRelayBrokerError extends Error {
  constructor() {
    super('stale_relay_broker')
  }
}

export class RelaySessionBroker {
  private readonly options: RelaySessionBrokerOptions
  private readonly relayHostId: string
  private control: RelayControlClient | null = null
  private transport: CloudRelayTransport | null = null
  private authorization: RelayAuthorization | null = null
  private assignment: RelayAssignment | null = null
  private refreshTimer: ReturnType<typeof setTimeout> | null = null
  private closed = false

  private constructor(options: RelaySessionBrokerOptions) {
    this.options = options
    this.relayHostId = deriveRelayHostId(options.keypair.publicKey)
  }

  static async connect(options: RelaySessionBrokerOptions): Promise<RelaySessionBroker> {
    const broker = new RelaySessionBroker(options)
    try {
      await broker.open(options.accessToken)
      return broker
    } catch (error) {
      broker.closeNow()
      throw error
    }
  }

  get hostId(): string {
    return this.relayHostId
  }

  get currentAssignment(): RelayAssignment | null {
    return this.assignment
  }

  get ownerIdentityKey(): string {
    const identity = this.options.identity
    return `${identity.userId}\0${identity.profileId}\0${identity.organizationId}`
  }

  get endpoint(): MobileRelayEndpoint | null {
    const assignment = this.assignment
    if (!assignment) {
      return null
    }
    return {
      v: 1,
      directorUrl: this.options.authConfig.relayDirectorUrl,
      cellUrl: assignment.cellUrl,
      assignmentEpoch: assignment.assignmentEpoch,
      relayHostId: this.relayHostId,
      e2eeFraming: 2
    }
  }

  createInvite(relayDeviceId: string): ReturnType<RelayControlClient['createInvite']> {
    if (!this.control) {
      return Promise.reject(new Error('relay_control_not_active'))
    }
    return this.control.createInvite(relayDeviceId)
  }

  async createPairingRelay(relayDeviceId: string): Promise<PairingRelay> {
    const assignment = this.assignment
    if (!assignment || !this.control) {
      throw new Error('relay_control_not_active')
    }
    const invite = await this.control.createInvite(relayDeviceId)
    this.assertCurrent()
    return {
      v: 1,
      directorUrl: this.options.authConfig.relayDirectorUrl,
      cellUrl: assignment.cellUrl,
      assignmentEpoch: assignment.assignmentEpoch,
      relayHostId: this.relayHostId,
      inviteToken: invite.inviteToken,
      inviteExpiresAt: invite.expiresAt,
      e2eeFraming: 2
    }
  }

  revokeDevice(relayDeviceId: string, reqId?: string): Promise<void> {
    if (!this.control) {
      return Promise.reject(new Error('relay_control_not_active'))
    }
    return this.control.revokeDevice(relayDeviceId, reqId)
  }

  async installCredential(
    relayDeviceId: string,
    params: PairingProvisionRelayParams,
    authorization: DeviceCredentialInstallAuthorization
  ): Promise<DeviceCredentialInstalled> {
    if (!this.control) {
      throw new Error('relay_control_not_active')
    }
    const message = await this.control.installCredential({
      relayDeviceId,
      authorization,
      ...params
    })
    this.assertCurrent()
    const { type: _type, ...result } = message
    return result
  }

  async credentialInstallStatus(
    relayDeviceId: string,
    reqId: string
  ): Promise<DeviceCredentialInstallStatusResult> {
    if (!this.control) {
      throw new Error('relay_control_not_active')
    }
    const message = await this.control.credentialInstallStatus(relayDeviceId, reqId)
    this.assertCurrent()
    const { type: _type, ...result } = message
    return result
  }

  async confirmResume(basisConnId: string, reqId: string): Promise<DeviceResumeConfirmed> {
    if (!this.control) {
      throw new Error('relay_control_not_active')
    }
    const message = await this.control.confirmResume(basisConnId, reqId)
    this.assertCurrent()
    const { type: _type, ...result } = message
    return result
  }

  closeNow(): void {
    if (this.closed) {
      return
    }
    this.closed = true
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = null
    }
    this.control?.closeNow()
    this.control = null
    void this.transport?.stop()
    this.transport = null
    this.options.onStatus('offline')
  }

  private async open(accessToken: string): Promise<void> {
    this.options.onStatus('connecting')
    const authorization = await exchangeRelayAuthorization({
      endpoint: this.options.authConfig.relayTokenEndpoint,
      accessToken,
      keypair: this.options.keypair,
      fetch: this.options.fetch
    })
    this.assertCurrent()
    const assignment = await requestRelayAssignment({
      directorUrl: this.options.authConfig.relayDirectorUrl,
      relayToken: authorization.relayToken,
      relayHostId: this.relayHostId,
      fetch: this.options.fetch
    })
    this.assertCurrent()
    const transport = new CloudRelayTransport({
      cellUrl: assignment.cellUrl,
      relayHostId: this.relayHostId,
      generation: 0,
      createSocket: this.options.createDataSocket
    })
    this.options.mobileSocketWiring.attachTransport(transport, (ws) => transport.metadataFor(ws))
    await transport.start()
    this.assertCurrent()
    const control = new RelayControlClient({
      cellUrl: assignment.cellUrl,
      relayJwt: authorization.relayToken,
      relayHostId: this.relayHostId,
      assignmentEpoch: assignment.assignmentEpoch,
      identity: this.options.identity,
      keypair: this.options.keypair,
      appVersion: this.options.appVersion,
      onConnectionOpen: (message) => {
        void transport.openConnection(message).catch(() => {})
      },
      onDrain: () => {
        this.options.onStatus('draining')
        // Why: the data plane never chooses recovery targets; every drain
        // returns to the configured stable director.
        this.options.onResolveDirector()
      },
      onClose: () => {
        if (!this.closed) {
          this.options.onStatus('offline')
        }
      },
      createSocket: this.options.createControlSocket
    })
    const ack = await control.connect()
    this.assertCurrent()
    if (ack.generation <= 0) {
      throw new Error('invalid_relay_generation')
    }
    transport.setGeneration(ack.generation)
    this.authorization = authorization
    this.assignment = assignment
    this.transport = transport
    this.control = control
    this.options.onStatus('registered')
    this.scheduleRefresh()
  }

  private scheduleRefresh(): void {
    const authorization = this.authorization
    if (!authorization || this.closed) {
      return
    }
    const now = (this.options.now ?? Date.now)()
    const random = this.options.random ?? Math.random
    const earlyMs = 60_000 + Math.floor(random() * 60_001)
    const delay = Math.max(0, authorization.expiresAt - earlyMs - now)
    this.refreshTimer = setTimeout(() => void this.refreshAuthorization(), delay)
  }

  private async refreshAuthorization(): Promise<void> {
    this.refreshTimer = null
    try {
      const accessToken = await this.options.refreshAccessToken()
      this.assertCurrent()
      if (!accessToken) {
        this.closeNow()
        return
      }
      const authorization = await exchangeRelayAuthorization({
        endpoint: this.options.authConfig.relayTokenEndpoint,
        accessToken,
        keypair: this.options.keypair,
        fetch: this.options.fetch
      })
      this.assertCurrent()
      this.control?.refreshAuthorization(authorization.relayToken)
      this.authorization = authorization
      this.scheduleRefresh()
    } catch {
      const expiry = this.authorization?.expiresAt ?? 0
      const now = (this.options.now ?? Date.now)()
      if (!this.closed && this.options.isCurrent() && now <= expiry + 60_000) {
        const random = this.options.random ?? Math.random
        this.refreshTimer = setTimeout(
          () => void this.refreshAuthorization(),
          5_000 + Math.floor(random() * 10_001)
        )
        return
      }
      this.closeNow()
    }
  }

  private assertCurrent(): void {
    if (this.closed || !this.options.isCurrent()) {
      throw new StaleRelayBrokerError()
    }
  }
}

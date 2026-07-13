import {
  RelayControlErrorMessageSchema,
  RelayDeviceRevokedMessageSchema,
  RelayInviteCreatedMessageSchema,
  type RelayInviteCreatedMessage
} from './relay-control-protocol'

type PendingRequest = {
  kind: 'invite' | 'revoke'
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class RelayControlRequests {
  private readonly pending = new Map<string, PendingRequest>()

  createInvite(
    reqId: string,
    relayDeviceId: string,
    send: (payload: object) => void
  ): Promise<RelayInviteCreatedMessage> {
    return this.request(
      reqId,
      'invite',
      { type: 'invite-create', reqId, relayDeviceId },
      send
    ) as Promise<RelayInviteCreatedMessage>
  }

  revokeDevice(
    reqId: string,
    relayDeviceId: string,
    send: (payload: object) => void
  ): Promise<void> {
    return this.request(
      reqId,
      'revoke',
      { type: 'device-revoke', reqId, relayDeviceId },
      send
    ) as Promise<void>
  }

  resolveMessage(message: Record<string, unknown>): boolean {
    const reqId = typeof message.reqId === 'string' ? message.reqId : null
    const pending = reqId ? this.pending.get(reqId) : null
    if (!pending || !reqId) {
      return false
    }
    const error = RelayControlErrorMessageSchema.safeParse(message)
    if (error.success) {
      this.finish(reqId)
      pending.reject(new Error(error.data.code))
      return true
    }
    if (pending.kind === 'invite') {
      const invite = RelayInviteCreatedMessageSchema.safeParse(message)
      if (!invite.success) {
        return false
      }
      this.finish(reqId)
      pending.resolve(invite.data)
      return true
    }
    const revoked = RelayDeviceRevokedMessageSchema.safeParse(message)
    if (!revoked.success) {
      return false
    }
    this.finish(reqId)
    pending.resolve(undefined)
    return true
  }

  rejectAll(error: Error): void {
    for (const [reqId, pending] of this.pending) {
      this.finish(reqId)
      pending.reject(error)
    }
  }

  private request(
    reqId: string,
    kind: PendingRequest['kind'],
    payload: object,
    send: (payload: object) => void
  ): Promise<unknown> {
    if (this.pending.has(reqId)) {
      return Promise.reject(new Error('duplicate_relay_request_id'))
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId)
        reject(new Error('relay_control_request_timeout'))
      }, 10_000)
      this.pending.set(reqId, { kind, resolve, reject, timer })
      try {
        send(payload)
      } catch (error) {
        this.finish(reqId)
        reject(error)
      }
    })
  }

  private finish(reqId: string): void {
    const pending = this.pending.get(reqId)
    if (pending) {
      clearTimeout(pending.timer)
      this.pending.delete(reqId)
    }
  }
}

import type { PairingRelay } from '../../../src/shared/mobile-relay-pairing-offer'
import type { MobileRelayPairingJournal } from './mobile-relay-pairing-journal'
import { RelayOuterError, type PairingCandidateClient } from './mobile-relay-physical-client'

export function createRecoveringPairingRelayCandidate(args: {
  journal: MobileRelayPairingJournal
  connect: (relay: PairingRelay) => PairingCandidateClient
  resolveDirector: (relay: PairingRelay) => Promise<PairingRelay>
  persistMove: (relay: PairingRelay) => Promise<void>
  now: () => number
}): PairingCandidateClient {
  let relay = pairingRelayFromJournal(args.journal)
  let client = args.connect(relay)
  let recoveryAttempted = false
  let closed = false

  return {
    async sendRequest(method, params) {
      try {
        return await client.sendRequest(method, params)
      } catch (error) {
        if (
          method !== 'status.get' ||
          recoveryAttempted ||
          closed ||
          relay.inviteExpiresAt <= args.now() ||
          !isDirectorRecoverable(error)
        ) {
          throw error
        }
        recoveryAttempted = true
        const moved = await args.resolveDirector(relay)
        // Why: the authenticated newer assignment must be durable before a
        // target dial so a crash cannot revert to the known-stale cell.
        await args.persistMove(moved)
        client.close()
        relay = moved
        client = args.connect(relay)
        return client.sendRequest(method, params)
      }
    },
    close() {
      closed = true
      client.close()
    }
  }
}

function pairingRelayFromJournal(journal: MobileRelayPairingJournal): PairingRelay {
  return {
    ...journal.metadata.relay,
    inviteToken: journal.secrets.inviteToken
  }
}

function isDirectorRecoverable(error: unknown): boolean {
  if (!(error instanceof RelayOuterError)) {
    return true
  }
  return error.code === 4409 || error.code === 4503 || error.code === 1006
}

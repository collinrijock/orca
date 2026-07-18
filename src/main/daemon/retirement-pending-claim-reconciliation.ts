import type { Store } from '../persistence'
import type { IPtyProvider } from '../providers/types'
import type { TerminalBindingProvenance } from '../../shared/daemon-session-ownership'

const MAX_PENDING_RETRIES_PER_LAUNCH = 4_096

export async function reconcileRetirementPendingDaemonClaims(
  store: Store,
  provider: IPtyProvider
): Promise<void> {
  const allPending = (store.getDaemonSessionOwnership()?.claims ?? []).filter(
    (claim) => claim.ownerKind === 'retirement-pending'
  )
  // Why: a fixed prefix lets persistent live claims starve every later absence;
  // rotating the bounded launch window eventually examines the whole set.
  const start = allPending.length === 0 ? 0 : Date.now() % allPending.length
  const pending = Array.from(
    { length: Math.min(allPending.length, MAX_PENDING_RETRIES_PER_LAUNCH) },
    (_, offset) => allPending[(start + offset) % allPending.length]!
  )
  for (const claim of pending) {
    const provenance: TerminalBindingProvenance = {
      kind: 'local-daemon',
      protocolVersion: claim.protocolVersion
    }
    try {
      const processes = await provider.listProcessesForBinding?.(provenance)
      if (!processes) {
        continue
      }
      if (processes.some(({ id }) => id === claim.sessionId)) {
        // Why: old pending claims lack a PTY-incarnation token. A live same-ID
        // session may have been reclaimed, so startup may observe but never stop it.
        continue
      }
      // Why: a healthy exact-generation re-list proves the user's earlier
      // close completed; only then may the durable keep claim and route clear.
      if (
        store.clearVerifiedRetirementPendingDaemonClaim({
          sessionId: claim.sessionId,
          protocolVersion: claim.protocolVersion
        })
      ) {
        provider.forgetPtyRouteAfterVerifiedStop?.(claim.sessionId, provenance)
      }
    } catch (error) {
      console.warn(
        '[daemon] Deferred retirement-pending reconciliation:',
        error instanceof Error ? error.message : String(error)
      )
    }
  }
}

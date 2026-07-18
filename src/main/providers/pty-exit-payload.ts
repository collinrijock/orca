import type { TerminalBindingProvenance } from '../../shared/daemon-session-ownership'

export type PtyExitPayload = {
  id: string
  code: number
  /** Immutable physical provider identity captured where the exit originated. */
  provenance?: TerminalBindingProvenance
  /** Internal synthetic exits set this only after the exact daemon was verified gone. */
  verifiedAbsent?: boolean
}

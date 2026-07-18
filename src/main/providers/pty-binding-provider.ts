import type { TerminalBindingProvenance } from '../../shared/daemon-session-ownership'

export type PtyBindingProvider<TProcess> = {
  /** Durable physical provenance for a spawned or routed binding. */
  getPtyBindingProvenance?: (id: string) => TerminalBindingProvenance
  /** Drop retained routing only after a healthy provider listing proved absence. */
  forgetPtyRouteAfterVerifiedStop?: (id: string, expected: TerminalBindingProvenance) => boolean
  /** List only the physical provider named by an exit/claim, never an aggregate route. */
  listProcessesForBinding?: (provenance: TerminalBindingProvenance) => Promise<TProcess[]>
  /** Fires only after a complete physical-provider inventory succeeds. */
  onPtyBindingInventoryAvailable?: (
    callback: (provenance: TerminalBindingProvenance) => void
  ) => () => void
}

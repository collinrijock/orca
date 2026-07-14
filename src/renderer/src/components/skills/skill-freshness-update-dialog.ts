let pendingOpen = false
const listeners = new Set<() => void>()

// Why: the nudge action and the settings entry point can fire an open request
// before the always-mounted dialog subscribes. The pending flag lets the dialog
// consume a request on mount, so a request can never be lost to mount ordering.
export function requestSkillFreshnessUpdateDialog(): void {
  pendingOpen = true
  for (const listener of listeners) {
    listener()
  }
}

export function consumeSkillFreshnessUpdateDialogRequest(): boolean {
  const requested = pendingOpen
  pendingOpen = false
  return requested
}

export function subscribeSkillFreshnessUpdateDialog(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

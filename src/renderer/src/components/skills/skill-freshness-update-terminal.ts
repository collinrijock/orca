let pendingOpen = false
const listeners = new Set<() => void>()

export function requestSkillFreshnessUpdateTerminal(): void {
  pendingOpen = true
  for (const listener of listeners) {
    listener()
  }
}

export function consumeSkillFreshnessUpdateTerminalRequest(): boolean {
  const requested = pendingOpen
  pendingOpen = false
  return requested
}

export function subscribeSkillFreshnessUpdateTerminal(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

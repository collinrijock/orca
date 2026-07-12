type RetainedPtyKill = {
  diagnostic: string
  inFlight: Promise<void> | null
}

const retainedPtyKills = new Map<string, RetainedPtyKill>()

/**
 * Keep exact PTY identity until the owning provider accepts shutdown. A rejected
 * local/SSH IPC call can otherwise leave a live process with no renderer owner.
 */
export function killPtyRetainingRetryOwnership(id: string, diagnostic: string): Promise<void> {
  const retained = retainedPtyKills.get(id) ?? { diagnostic, inFlight: null }
  retained.diagnostic = diagnostic
  retainedPtyKills.set(id, retained)
  if (retained.inFlight) {
    return retained.inFlight
  }

  const attempt = Promise.resolve()
    .then(() => window.api.pty.kill(id))
    .then(() => {
      retainedPtyKills.delete(id)
    })
    .catch((error: unknown) => {
      console.warn(retained.diagnostic, error)
      throw error
    })
    .finally(() => {
      if (retained.inFlight === attempt) {
        retained.inFlight = null
      }
    })
  retained.inFlight = attempt
  return attempt
}

/** Retry on the next PTY lifecycle event; no polling or permanent timer is added. */
export function retryRetainedPtyKills(): void {
  for (const [id, retained] of retainedPtyKills) {
    void killPtyRetainingRetryOwnership(id, retained.diagnostic).catch(() => {})
  }
}

export function releaseRetainedPtyKillOwnership(id: string): void {
  retainedPtyKills.delete(id)
}

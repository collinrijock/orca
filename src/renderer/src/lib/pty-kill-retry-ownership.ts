type RetainedPtyKill = {
  diagnostic: string
  inFlight: Promise<void> | null
  options?: PtyKillIdentity
  attempts: number
  nextRetryAt: number
}

export type PtyKillIdentity = {
  expectedPaneKey?: string
  expectedTabId?: string
}

const MAX_RETAINED_PTY_KILLS = 64
const MAX_RETRY_BACKOFF_MS = 30_000
const retainedPtyKills = new Map<string, RetainedPtyKill>()

/**
 * Keep exact PTY identity until the owning provider accepts shutdown. A rejected
 * local/SSH IPC call can otherwise leave a live process with no renderer owner.
 */
export function killPtyRetainingRetryOwnership(
  id: string,
  diagnostic: string,
  options?: PtyKillIdentity
): Promise<void> {
  let retained = retainedPtyKills.get(id)
  if (!retained) {
    if (retainedPtyKills.size >= MAX_RETAINED_PTY_KILLS) {
      const oldestId = retainedPtyKills.keys().next().value
      if (typeof oldestId === 'string') {
        retainedPtyKills.delete(oldestId)
        console.warn('[pty] Dropped oldest retained shutdown retry at bounded capacity')
      }
    }
    retained = { diagnostic, inFlight: null, options, attempts: 0, nextRetryAt: 0 }
  }
  retained.diagnostic = diagnostic
  retained.options = options ?? retained.options
  retainedPtyKills.set(id, retained)
  if (retained.inFlight) {
    return retained.inFlight
  }

  const attempt = Promise.resolve()
    .then(() =>
      retained.options ? window.api.pty.kill(id, retained.options) : window.api.pty.kill(id)
    )
    .then(() => {
      retainedPtyKills.delete(id)
    })
    .catch((error: unknown) => {
      retained.attempts += 1
      retained.nextRetryAt =
        retained.attempts === 1
          ? 0
          : Date.now() +
            Math.min(MAX_RETRY_BACKOFF_MS, 250 * 2 ** Math.min(retained.attempts - 1, 7))
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
  const now = Date.now()
  for (const [id, retained] of retainedPtyKills) {
    if (!retained.inFlight && retained.nextRetryAt <= now) {
      void killPtyRetainingRetryOwnership(id, retained.diagnostic, retained.options).catch(() => {})
      return
    }
  }
}

export function releaseRetainedPtyKillOwnership(id: string): void {
  retainedPtyKills.delete(id)
}

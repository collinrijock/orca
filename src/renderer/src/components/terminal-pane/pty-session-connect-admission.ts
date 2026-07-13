const sessionAdmissionTails = new Map<string, Promise<void>>()

export async function acquirePtySessionConnectAdmission(sessionId: string): Promise<() => void> {
  const predecessor = sessionAdmissionTails.get(sessionId) ?? Promise.resolve()
  let releaseCurrent!: () => void
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve
  })
  const tail = predecessor.then(() => current)
  sessionAdmissionTails.set(sessionId, tail)

  await predecessor
  let released = false
  return () => {
    if (released) {
      return
    }
    released = true
    releaseCurrent()
    // Why: a settled predecessor must not delete a newer queued owner.
    if (sessionAdmissionTails.get(sessionId) === tail) {
      sessionAdmissionTails.delete(sessionId)
    }
  }
}

export function getPtySessionConnectAdmissionCountForTest(): number {
  return sessionAdmissionTails.size
}

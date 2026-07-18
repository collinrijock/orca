import { useCallback, useEffect, useRef, useState } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcFailure, RpcSuccess } from '../transport/types'
import type { TerminalQuickCommand } from '../../../src/shared/types'

type Args = {
  client: RpcClient | null
  // Fetch only while the sheet is open — quick commands are settings data we
  // don't need to keep hydrated for every session screen.
  enabled: boolean
}

type QuickCommandsState = {
  commands: TerminalQuickCommand[]
  loading: boolean
  ready: boolean
  error: string | null
  // Optimistically apply against the latest local list, then serialize writes.
  // The server re-normalizes and returns the canonical list, which we adopt.
  persist: (update: (current: TerminalQuickCommand[]) => TerminalQuickCommand[]) => Promise<boolean>
}

function readQuickCommands(result: unknown): TerminalQuickCommand[] {
  const list = (result as { terminalQuickCommands?: unknown } | null)?.terminalQuickCommands
  return Array.isArray(list) ? (list as TerminalQuickCommand[]) : []
}

export function useQuickCommands({ client, enabled }: Args): QuickCommandsState {
  const [commands, setCommands] = useState<TerminalQuickCommand[]>([])
  const [loading, setLoading] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const commandsRef = useRef<TerminalQuickCommand[]>([])
  const confirmedCommandsRef = useRef<TerminalQuickCommand[]>([])
  const operationIdRef = useRef(0)
  const mutationQueueRef = useRef<Promise<void>>(Promise.resolve())
  const mutationClientRef = useRef<RpcClient | null>(client)

  useEffect(() => {
    if (!enabled || !client) {
      setReady(false)
      return
    }
    if (mutationClientRef.current !== client) {
      // A request for an old host must not delay or update mutations on a new one.
      mutationClientRef.current = client
      mutationQueueRef.current = Promise.resolve()
    }
    let stale = false
    const operationId = operationIdRef.current + 1
    operationIdRef.current = operationId
    setLoading(true)
    setReady(false)
    setError(null)

    void (async () => {
      try {
        // A close/reopen can overlap an in-flight save. Read only after that
        // save settles so an older snapshot cannot replace its canonical result.
        await mutationQueueRef.current
        if (stale || operationId !== operationIdRef.current) {
          return
        }
        const response = await client.sendRequest('settings.getTerminalQuickCommands')
        if (stale || operationId !== operationIdRef.current) {
          return
        }
        if (!response.ok) {
          setError((response as RpcFailure).error.message || 'Failed to load quick commands')
          return
        }
        const next = readQuickCommands((response as RpcSuccess).result)
        commandsRef.current = next
        confirmedCommandsRef.current = next
        setCommands(next)
        setReady(true)
      } catch (err) {
        if (!stale && operationId === operationIdRef.current) {
          setError(err instanceof Error ? err.message : 'Failed to load quick commands')
        }
      } finally {
        if (!stale && operationId === operationIdRef.current) {
          setLoading(false)
        }
      }
    })()

    return () => {
      stale = true
    }
  }, [client, enabled])

  const persist = useCallback(
    async (update: (current: TerminalQuickCommand[]) => TerminalQuickCommand[]) => {
      // Mutating before the latest remote read completes could overwrite
      // commands created by desktop while this sheet was closed.
      if (!client || loading || !ready || mutationClientRef.current !== client) {
        return false
      }
      const previous = commandsRef.current
      const next = update(previous)
      const operationId = operationIdRef.current + 1
      operationIdRef.current = operationId
      commandsRef.current = next
      setCommands(next)
      setError(null)

      const send = async () => {
        const response = await client.sendRequest('settings.updateTerminalQuickCommands', {
          terminalQuickCommands: next
        })
        if (!response.ok) {
          throw new Error((response as RpcFailure).error.message || 'Failed to save quick command')
        }
        return response
      }
      const request = mutationQueueRef.current.then(send, send)
      mutationQueueRef.current = request.then(
        () => undefined,
        () => undefined
      )

      try {
        const response = await request
        const canonical = readQuickCommands((response as RpcSuccess).result)
        if (mutationClientRef.current === client) {
          confirmedCommandsRef.current = canonical
        }
        if (operationId === operationIdRef.current && mutationClientRef.current === client) {
          commandsRef.current = canonical
          setCommands(canonical)
        }
        return true
      } catch (err) {
        // An older failure must not roll back a newer optimistic mutation.
        if (operationId === operationIdRef.current) {
          // Why: `previous` may include an older optimistic write that also
          // failed; roll back to the latest server-confirmed canonical list.
          const confirmed = confirmedCommandsRef.current
          commandsRef.current = confirmed
          setCommands(confirmed)
          setError(err instanceof Error ? err.message : 'Failed to save quick command')
        }
        return false
      }
    },
    [client, loading, ready]
  )

  return { commands, loading, ready, error, persist }
}

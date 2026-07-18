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
  error: string | null
  reload: () => void
  // Optimistically apply `next` locally, then persist through settings.update.
  // The server re-normalizes and returns the canonical list, which we adopt.
  persist: (next: TerminalQuickCommand[]) => Promise<boolean>
}

function readQuickCommands(result: unknown): TerminalQuickCommand[] {
  const settings = (result as { settings?: { terminalQuickCommands?: unknown } } | null)?.settings
  const list = settings?.terminalQuickCommands
  return Array.isArray(list) ? (list as TerminalQuickCommand[]) : []
}

export function useQuickCommands({ client, enabled }: Args): QuickCommandsState {
  const [commands, setCommands] = useState<TerminalQuickCommand[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const requestIdRef = useRef(0)

  const reload = useCallback(() => setReloadToken((token) => token + 1), [])

  useEffect(() => {
    if (!enabled || !client) {
      return
    }
    let stale = false
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    setLoading(true)
    setError(null)

    void (async () => {
      try {
        const response = await client.sendRequest('settings.get')
        if (stale) {
          return
        }
        if (!response.ok) {
          setError((response as RpcFailure).error.message || 'Failed to load quick commands')
          return
        }
        setCommands(readQuickCommands((response as RpcSuccess).result))
      } catch (err) {
        if (!stale) {
          setError(err instanceof Error ? err.message : 'Failed to load quick commands')
        }
      } finally {
        if (!stale) {
          setLoading(false)
        }
      }
    })()

    return () => {
      stale = true
    }
  }, [client, enabled, reloadToken])

  const persist = useCallback(
    async (next: TerminalQuickCommand[]) => {
      if (!client) {
        return false
      }
      const previous = commands
      setCommands(next)
      setError(null)
      try {
        const response = await client.sendRequest('settings.update', {
          terminalQuickCommands: next
        })
        if (!response.ok) {
          setCommands(previous)
          setError((response as RpcFailure).error.message || 'Failed to save quick command')
          return false
        }
        // Adopt the server's normalized list (drops invalid rows, caps length).
        setCommands(readQuickCommands((response as RpcSuccess).result))
        return true
      } catch (err) {
        setCommands(previous)
        setError(err instanceof Error ? err.message : 'Failed to save quick command')
        return false
      }
    },
    [client, commands]
  )

  return { commands, loading, error, reload, persist }
}

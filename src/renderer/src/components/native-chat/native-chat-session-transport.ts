import type {
  NativeChatApi,
  NativeChatAppendedMessages,
  NativeChatReadSessionResult
} from '../../../../preload/api-types'
import { isWebClientLocation } from '@/lib/web-client-location'
import {
  callRuntimeRpc,
  RuntimeRpcCallError,
  type RuntimeClientTarget
} from '@/runtime/runtime-rpc-client'
import { isRuntimeCompatBlockError } from '@/runtime/runtime-protocol-compat'

/** The read/subscribe surface the live-session hook needs, decoupled from where
 *  the transcript actually lives. Same shape as `window.api.nativeChat`, so the
 *  hook and everything downstream (merge, assembler, pagination) are unchanged. */
export type NativeChatSessionTransport = Pick<NativeChatApi, 'readSession' | 'subscribe'>

const RUNTIME_TOO_OLD =
  'This remote runtime is too old to show agent chat history. Update the remote runtime to view it.'

/** Map a runtime read failure to the message the read-error state renders. A
 *  version block (old runtime lacking the method, or the protocol-compat gate)
 *  gets the explicit "update the remote runtime" copy (R4); anything else — a
 *  timeout or transport error — gets a generic message, so a transient failure is
 *  never mislabeled as a version problem (KTD-4, not catch-all). */
export function toRuntimeNativeChatErrorMessage(err: unknown): string {
  if (err instanceof RuntimeRpcCallError && err.code === 'method_not_found') {
    return RUNTIME_TOO_OLD
  }
  if (isRuntimeCompatBlockError(err)) {
    return RUNTIME_TOO_OLD
  }
  return "Couldn't read agent chat from the remote runtime."
}

/** Delegates straight to the local Electron IPC bridge. On the web client
 *  `window.api.nativeChat` already bridges to the paired runtime, so web keeps
 *  using this adapter (R3). Preserves whatever `subscribe` returns (sync fn on
 *  desktop, promise on the web bridge) — the hook's teardown handles both (R6). */
const localNativeChatTransport: NativeChatSessionTransport = {
  readSession: (agent, sessionId, limit, transcriptPath) =>
    window.api.nativeChat.readSession(agent, sessionId, limit, transcriptPath),
  subscribe: (args, onAppended) => window.api.nativeChat.subscribe(args, onAppended)
}

function createRuntimeNativeChatTransport(environmentId: string): NativeChatSessionTransport {
  const target: RuntimeClientTarget = { kind: 'environment', environmentId }

  return {
    readSession: async (agent, sessionId, limit, transcriptPath) => {
      try {
        return await callRuntimeRpc<NativeChatReadSessionResult>(
          target,
          'nativeChat.readSession',
          { agent, sessionId, limit, transcriptPath },
          { timeoutMs: 15_000 }
        )
      } catch (err) {
        return { error: toRuntimeNativeChatErrorMessage(err) }
      }
    },
    subscribe: (args, onAppended) => {
      const { subscriptionId, agent, sessionId, transcriptPath } = args
      let cancelled = false
      let handleUnsubscribe: (() => void) | null = null

      void window.api.runtimeEnvironments
        .subscribe(
          {
            selector: environmentId,
            method: 'nativeChat.subscribe',
            params: { subscriptionId, agent, sessionId, transcriptPath },
            timeoutMs: 15_000
          },
          {
            onResponse: (response) => {
              if (cancelled) {
                return
              }
              if (response.ok === false) {
                return
              }
              const frame = response.result as {
                type?: string
                messages?: NativeChatAppendedMessages
              }
              if (frame?.type === 'appended' && Array.isArray(frame.messages)) {
                onAppended(frame.messages)
              }
            }
          }
        )
        .then((handle) => {
          handleUnsubscribe = handle.unsubscribe
          // The stream resolved after teardown already ran — close it now so the
          // late-arriving handle doesn't leak (same race as runtime-file-client).
          if (cancelled) {
            handle.unsubscribe()
            handleUnsubscribe = null
          }
        })
        .catch(() => {
          // A failed subscribe surfaces through the parallel readSession's error
          // mapping; the live tail simply never starts, nothing to tear down.
        })

      // Sync unsubscribe does two distinct jobs (KTD-6): (a) tear down the
      // renderer dispatcher + runtime stream, and (b) reap the runtime-side
      // fs-watcher, keyed by the SAME subscriptionId the subscribe sent (KTD-5).
      return () => {
        cancelled = true
        handleUnsubscribe?.()
        handleUnsubscribe = null
        void callRuntimeRpc<{ unsubscribed: boolean }>(
          target,
          'nativeChat.unsubscribe',
          { subscriptionId },
          { timeoutMs: 15_000 }
        ).catch(() => {
          // Best-effort: the watcher also reaps when the connection closes.
        })
      }
    }
  }
}

/** Select the read/subscribe transport for a pane. Route to the remote runtime
 *  only for a `runtime:`-owned pane on a non-web client (KTD-2); web and
 *  local/`ssh:`-owned panes keep the local adapter. */
export function getNativeChatSessionTransport(
  runtimeEnvironmentId: string | null
): NativeChatSessionTransport {
  if (runtimeEnvironmentId && !isWebClientLocation()) {
    return createRuntimeNativeChatTransport(runtimeEnvironmentId)
  }
  return localNativeChatTransport
}

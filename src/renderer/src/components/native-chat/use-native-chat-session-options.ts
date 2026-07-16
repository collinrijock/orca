import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { AgentType } from '../../../../shared/agent-status-types'
import { updateNativeChatSessionOptionDefaults } from '../../../../shared/native-chat-session-option-defaults'
import type { SessionOptionDescriptor } from '../../../../shared/native-chat-session-options'
import { useAppStore } from '../../store'
import {
  createNativeChatPtySessionOptions,
  type NativeChatPtySessionOptionsSurface
} from './native-chat-pty-session-options'
import type { NativeChatSessionOptionDispatchCommand } from './native-chat-session-option-command-dispatch'
import {
  ensureNativeChatModelEnrichment,
  readNativeChatEnrichedModels,
  subscribeNativeChatEnrichedModels
} from './native-chat-session-option-enrichment'
import {
  discoverNativeChatCatalogModels,
  resolveNativeChatModelDiscoveryContext
} from './native-chat-session-option-discovery'

const EMPTY_SNAPSHOT: SessionOptionDescriptor[] = []
const subscribeEmpty = (): (() => void) => () => {}
const getEmptySnapshot = (): SessionOptionDescriptor[] => EMPTY_SNAPSHOT

export function useNativeChatSessionOptions(args: {
  agent: AgentType
  terminalTabId: string
  targetPtyId: string | null
  dispatchCommand: NativeChatSessionOptionDispatchCommand
  onAgentPicker?: () => void
}): {
  surface: NativeChatPtySessionOptionsSurface | null
  snapshot: SessionOptionDescriptor[]
} {
  const discoveryContext = useMemo(
    () => resolveNativeChatModelDiscoveryContext(args.terminalTabId),
    [args.terminalTabId]
  )
  const surface = useMemo(() => {
    // Why: native chat currently attaches only after startup is already queued;
    // exposing a draft picker here would claim it can still mutate that command.
    if (!args.targetPtyId) {
      return null
    }
    const scopeKey = args.targetPtyId ?? args.terminalTabId
    let settingsWrite = Promise.resolve()
    return createNativeChatPtySessionOptions({
      agent: args.agent,
      scopeKey,
      ...(args.targetPtyId ? { fallbackScopeKey: args.terminalTabId } : {}),
      ...(discoveryContext
        ? {
            initialModels:
              readNativeChatEnrichedModels(args.agent, discoveryContext.hostKey) ?? undefined
          }
        : {}),
      mode: args.targetPtyId ? 'live' : 'draft',
      dispatchCommand: args.dispatchCommand,
      onAgentPicker: args.onAgentPicker,
      persistSelection: async ({ modelId, optionId, value }) => {
        // Why: read the live persisted defaults at write time (after any prior
        // write in this chain settles) and merge only this selection onto them,
        // rather than a baseline captured once at surface creation. A frozen
        // baseline would let a second same-agent pane's write be clobbered,
        // since updateSettings shallow-merges nativeChatSessionOptions. Chaining
        // still keeps rapid consecutive picks in selection order.
        settingsWrite = settingsWrite
          .catch(() => undefined)
          .then(() => {
            const base = useAppStore.getState().settings?.nativeChatSessionOptions
            const next = updateNativeChatSessionOptionDefaults({
              persisted: base,
              agent: args.agent,
              modelId,
              optionId,
              value
            })
            return useAppStore.getState().updateSettings({ nativeChatSessionOptions: next })
          })
        await settingsWrite
      }
    })
  }, [
    args.agent,
    args.dispatchCommand,
    discoveryContext,
    args.onAgentPicker,
    args.targetPtyId,
    args.terminalTabId
  ])

  useEffect(() => {
    if (!surface || !discoveryContext) {
      return
    }
    const unsubscribe = subscribeNativeChatEnrichedModels(
      args.agent,
      discoveryContext.hostKey,
      (models) => surface.replaceModels(models)
    )
    ensureNativeChatModelEnrichment({
      agent: args.agent,
      hostKey: discoveryContext.hostKey,
      discover: () => discoverNativeChatCatalogModels(args.agent, discoveryContext.runtime)
    })
    return unsubscribe
  }, [args.agent, discoveryContext, surface])

  const snapshot = useSyncExternalStore(
    surface?.subscribe ?? subscribeEmpty,
    surface?.getSnapshot ?? getEmptySnapshot,
    surface?.getSnapshot ?? getEmptySnapshot
  )
  return { surface, snapshot }
}

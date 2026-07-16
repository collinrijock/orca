import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { AgentType } from '../../../../shared/agent-status-types'
import { updateNativeChatSessionOptionDefaults } from '../../../../shared/native-chat-session-option-defaults'
import type { SessionOptionDescriptor } from '../../../../shared/native-chat-session-options'
import { useAppStore } from '../../store'
import {
  createNativeChatPtySessionOptions,
  type NativeChatPtySessionOptionsSurface
} from './native-chat-pty-session-options'
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
  dispatchCommand: (command: string) => Promise<void> | void
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
    let persisted = useAppStore.getState().settings?.nativeChatSessionOptions
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
        persisted = updateNativeChatSessionOptionDefaults({
          persisted,
          agent: args.agent,
          modelId,
          optionId,
          value
        })
        const nextPersisted = persisted
        // Why: rapid consecutive picks must reach electron-store in selection
        // order or a slower older write can erase the newer model-scoped value.
        settingsWrite = settingsWrite
          .catch(() => undefined)
          .then(() =>
            useAppStore.getState().updateSettings({ nativeChatSessionOptions: nextPersisted })
          )
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

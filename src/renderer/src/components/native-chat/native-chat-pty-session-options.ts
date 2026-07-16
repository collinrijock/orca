import {
  findCatalogModel,
  findCatalogOption,
  getAgentSessionOptionCatalog,
  type CatalogMidSessionApply,
  type CatalogModel,
  type CatalogOptionApply
} from '../../../../shared/agent-session-option-catalog'
import type { AgentType } from '../../../../shared/agent-status-types'
import type {
  SessionOptionDescriptor,
  SessionOptionsSurface,
  SessionOptionValue
} from '../../../../shared/native-chat-session-options'
import {
  createNativeChatSessionOptionRecord,
  readNativeChatSessionOptionCache,
  writeNativeChatSessionOptionCache
} from './native-chat-session-option-cache'
import {
  buildNativeChatSessionOptionSnapshot,
  flattenNativeChatSessionOptionRecord,
  type NativeChatSessionOptionMode
} from './native-chat-session-option-snapshot'

type PersistSelection = (args: {
  modelId: string
  optionId: string
  value: SessionOptionValue
}) => Promise<void> | void

export type NativeChatPtySessionOptionsSurface = SessionOptionsSurface & {
  recordOutgoingCommand(command: string): void
  replaceModels(models: CatalogModel[]): void
}

export type CreateNativeChatPtySessionOptionsArgs = {
  agent: AgentType
  scopeKey: string
  fallbackScopeKey?: string
  initialModels?: readonly CatalogModel[]
  mode: NativeChatSessionOptionMode
  dispatchCommand: (command: string) => Promise<void> | void
  onAgentPicker?: () => void
  persistSelection?: PersistSelection
  onDraftValuesChanged?: (values: Record<string, SessionOptionValue>) => void
}

function parseBuiltCommand(
  build: (value: SessionOptionValue) => string,
  command: string
): string | null {
  const marker = '__orca_session_option_value__'
  const template = build(marker)
  const markerIndex = template.indexOf(marker)
  if (markerIndex < 0) {
    return null
  }
  const prefix = template.slice(0, markerIndex)
  const suffix = template.slice(markerIndex + marker.length)
  if (!command.startsWith(prefix) || !command.endsWith(suffix)) {
    return null
  }
  const value = command.slice(prefix.length, command.length - suffix.length).trim()
  return value || null
}

export function createNativeChatPtySessionOptions(
  args: CreateNativeChatPtySessionOptionsArgs
): NativeChatPtySessionOptionsSurface | null {
  const catalog = getAgentSessionOptionCatalog(args.agent)
  if (!catalog) {
    return null
  }
  let models = [...(args.initialModels ?? catalog.models)]
  let record =
    readNativeChatSessionOptionCache(args.scopeKey, args.fallbackScopeKey) ??
    createNativeChatSessionOptionRecord(args.agent)
  if (record.agent !== args.agent) {
    record = createNativeChatSessionOptionRecord(args.agent)
  }
  let snapshot = buildNativeChatSessionOptionSnapshot({ catalog, models, record, mode: args.mode })
  const listeners = new Set<(value: SessionOptionDescriptor[]) => void>()

  const publish = (): SessionOptionDescriptor[] => {
    writeNativeChatSessionOptionCache(args.scopeKey, record)
    snapshot = buildNativeChatSessionOptionSnapshot({ catalog, models, record, mode: args.mode })
    for (const listener of listeners) {
      listener(snapshot)
    }
    return snapshot
  }

  const clearModelTruth = (): void => {
    const modelId = typeof record.model?.value === 'string' ? record.model.value : null
    record.model = undefined
    if (modelId) {
      delete record.valuesByModel[modelId]
    }
  }

  const setTrackedValue = (
    optionId: string,
    value: SessionOptionValue,
    source: 'applied' | 'dispatched'
  ): string | null => {
    if (optionId === 'model') {
      record.model = { value, source }
      return typeof value === 'string' ? value : null
    }
    const modelId = typeof record.model?.value === 'string' ? record.model.value : null
    if (!modelId) {
      return null
    }
    record.valuesByModel[modelId] = {
      ...record.valuesByModel[modelId],
      [optionId]: { value, source }
    }
    return modelId
  }

  const persist = (modelId: string | null, optionId: string, value: SessionOptionValue): void => {
    if (modelId) {
      void args.persistSelection?.({ modelId, optionId, value })
    }
  }

  const currentApply = (
    optionId: string
  ): { apply: CatalogOptionApply; modelId: string | null } | null => {
    const modelId = typeof record.model?.value === 'string' ? record.model.value : null
    if (optionId === 'model') {
      return { apply: catalog.modelApply, modelId }
    }
    const model = modelId ? findCatalogModel({ ...catalog, models }, modelId) : undefined
    const option = findCatalogOption(model, optionId)
    return option ? { apply: option.apply, modelId } : null
  }

  const commandForValue = (
    optionId: string,
    value: SessionOptionValue,
    apply: CatalogOptionApply,
    modelId: string | null
  ): string | null => {
    const midSession = apply.midSession
    if (midSession?.kind === 'command') {
      return midSession.build(value)
    }
    if (midSession?.kind === 'toggle-command' || midSession?.kind === 'agent-picker') {
      return midSession.command
    }
    if (!apply.composedIntoModel || !modelId || !catalog.composeModelValue) {
      return null
    }
    const model = findCatalogModel({ ...catalog, models }, modelId)
    const values = flattenNativeChatSessionOptionRecord(record, modelId)
    for (const option of model?.options ?? []) {
      values[option.id] ??= option.kind.defaultValue
    }
    values[optionId] = value
    const composed = catalog.composeModelValue(modelId, values)
    return catalog.modelApply.midSession?.kind === 'command'
      ? catalog.modelApply.midSession.build(composed)
      : null
  }

  const handleAgentPicker = async (midSession: CatalogMidSessionApply): Promise<void> => {
    if (midSession.kind !== 'agent-picker') {
      return
    }
    await args.dispatchCommand(midSession.command)
    clearModelTruth()
    publish()
    args.onAgentPicker?.()
  }

  const setOption = async (id: string, value: SessionOptionValue) => {
    const resolved = currentApply(id)
    if (!resolved) {
      throw new Error(`Unknown session option: ${id}`)
    }
    const { apply, modelId: previousModelId } = resolved
    if (args.mode === 'live' && apply.midSession?.kind === 'agent-picker') {
      await handleAgentPicker(apply.midSession)
      return { snapshot }
    }
    const source = args.mode === 'live' ? 'dispatched' : 'applied'
    const toggleWasKnown =
      apply.midSession?.kind === 'toggle-command' && previousModelId
        ? record.valuesByModel[previousModelId]?.[id] !== undefined
        : false
    if (args.mode === 'live') {
      const command = commandForValue(id, value, apply, previousModelId)
      if (!command) {
        throw new Error('This option can only be set when the session starts.')
      }
      await args.dispatchCommand(command)
    } else if (!apply.launchArgs && !apply.composedIntoModel) {
      throw new Error('This option is only available after the session starts.')
    }

    if (apply.midSession?.kind === 'toggle-command' && !toggleWasKnown) {
      return {
        snapshot: publish(),
        notice: 'Sent to the agent — current value is unknown'
      }
    }
    if (id === 'model' && previousModelId !== value) {
      record.model = undefined
      if (args.mode === 'live' && typeof value === 'string') {
        // Why: switching models can reset its effort/toggles. A value cached
        // from an earlier visit to that model is no longer live evidence.
        delete record.valuesByModel[value]
      }
    }
    const modelId = setTrackedValue(id, value, source)
    if (apply.midSession?.kind === 'toggle-command' && previousModelId && source === 'dispatched') {
      record.valuesByModel[previousModelId] = {
        ...record.valuesByModel[previousModelId],
        [id]: { value, source }
      }
    }
    persist(modelId ?? previousModelId, id, value)
    const next = publish()
    if (args.mode === 'draft' && typeof record.model?.value === 'string') {
      args.onDraftValuesChanged?.(flattenNativeChatSessionOptionRecord(record, record.model.value))
    }
    return {
      snapshot: next,
      ...(source === 'dispatched' ? { notice: 'Sent to the agent — not confirmed' } : {})
    }
  }

  const recordCommandApply = (
    optionId: string,
    midSession: CatalogMidSessionApply | undefined,
    command: string
  ): boolean => {
    if (!midSession || midSession.kind === 'unsupported') {
      return false
    }
    if (midSession.kind === 'toggle-command' && command === midSession.command) {
      const modelId = typeof record.model?.value === 'string' ? record.model.value : null
      if (modelId) {
        delete record.valuesByModel[modelId]?.[optionId]
      }
      return true
    }
    if (midSession.kind === 'agent-picker' && command === midSession.command) {
      clearModelTruth()
      return true
    }
    if (midSession.kind !== 'command') {
      return false
    }
    const value = parseBuiltCommand(midSession.build, command)
    if (!value) {
      return false
    }
    if (optionId === 'model') {
      const previousModelId = typeof record.model?.value === 'string' ? record.model.value : null
      if (previousModelId !== value) {
        // Why: a model command can reset model-scoped state, so an older value
        // from a prior visit is no longer evidence about this live session.
        delete record.valuesByModel[value]
      }
    }
    const modelId = setTrackedValue(optionId, value, 'dispatched')
    persist(modelId, optionId, value)
    return true
  }

  return {
    getSnapshot: () => snapshot,
    setOption,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    recordOutgoingCommand: (command) => {
      const trimmed = command.trim()
      let changed = recordCommandApply('model', catalog.modelApply.midSession, trimmed)
      const modelId = typeof record.model?.value === 'string' ? record.model.value : null
      const model = modelId ? findCatalogModel({ ...catalog, models }, modelId) : undefined
      for (const option of model?.options ?? []) {
        changed = recordCommandApply(option.id, option.apply.midSession, trimmed) || changed
      }
      if (changed) {
        publish()
      }
    },
    replaceModels: (nextModels) => {
      models = [...nextModels]
      publish()
    }
  }
}

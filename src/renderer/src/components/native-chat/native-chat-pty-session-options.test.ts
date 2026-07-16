import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearNativeChatSessionOptionCacheForTests,
  seedNativeChatAppliedSessionOptions
} from './native-chat-session-option-cache'
import { createNativeChatPtySessionOptions } from './native-chat-pty-session-options'

describe('native chat PTY session options', () => {
  beforeEach(() => clearNativeChatSessionOptionCacheForTests())

  it('starts attached sessions unknown and hides model-scoped options', () => {
    const surface = createNativeChatPtySessionOptions({
      agent: 'claude',
      scopeKey: 'pty-1',
      mode: 'live',
      dispatchCommand: vi.fn()
    })!
    expect(surface.getSnapshot()).toHaveLength(1)
    expect(surface.getSnapshot()[0]).toMatchObject({ id: 'model', valueSource: 'unknown' })
  })

  it('restores launch-backed values through the tab-to-PTY cache handoff', () => {
    seedNativeChatAppliedSessionOptions('tab-1', 'claude', {
      model: 'opus',
      effort: 'xhigh'
    })
    const surface = createNativeChatPtySessionOptions({
      agent: 'claude',
      scopeKey: 'pty-1',
      fallbackScopeKey: 'tab-1',
      mode: 'live',
      dispatchCommand: vi.fn()
    })!
    expect(surface.getSnapshot()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'model', valueSource: 'applied' }),
        expect.objectContaining({ id: 'effort', valueSource: 'applied' }),
        expect.objectContaining({ id: 'fastMode', valueSource: 'unknown' })
      ])
    )
  })

  it('dispatches Claude setters and publishes full dependent snapshots', async () => {
    const dispatch = vi.fn()
    const persist = vi.fn()
    const listener = vi.fn()
    const surface = createNativeChatPtySessionOptions({
      agent: 'claude',
      scopeKey: 'pty-1',
      mode: 'live',
      dispatchCommand: dispatch,
      persistSelection: persist
    })!
    surface.subscribe(listener)

    const modelResult = await surface.setOption('model', 'opus')
    expect(dispatch).toHaveBeenCalledWith('/model opus')
    expect(modelResult.snapshot.map(({ id }) => id)).toEqual(['model', 'effort', 'fastMode'])
    expect(modelResult.snapshot[0]).toMatchObject({ valueSource: 'dispatched' })
    expect(modelResult.snapshot[1]).toMatchObject({ valueSource: 'unknown' })

    const effortResult = await surface.setOption('effort', 'high')
    expect(dispatch).toHaveBeenLastCalledWith('/effort high')
    expect(effortResult.snapshot.find(({ id }) => id === 'effort')).toMatchObject({
      valueSource: 'dispatched',
      kind: { currentValue: 'high' }
    })
    expect(listener).toHaveBeenCalledTimes(2)
    expect(listener.mock.calls.every(([snapshot]) => Array.isArray(snapshot))).toBe(true)
    expect(persist).toHaveBeenCalledWith({ modelId: 'opus', optionId: 'effort', value: 'high' })
  })

  it('keeps an unknown toggle unknown after the one-shot action', async () => {
    seedNativeChatAppliedSessionOptions('pty-1', 'claude', { model: 'opus', effort: 'high' })
    const dispatch = vi.fn()
    const surface = createNativeChatPtySessionOptions({
      agent: 'claude',
      scopeKey: 'pty-1',
      mode: 'live',
      dispatchCommand: dispatch
    })!
    const fastBefore = surface.getSnapshot().find(({ id }) => id === 'fastMode')
    expect(fastBefore?.action?.type).toBe('toggle-command')

    const result = await surface.setOption('fastMode', true)
    expect(dispatch).toHaveBeenCalledWith('/fast')
    expect(result.snapshot.find(({ id }) => id === 'fastMode')).toMatchObject({
      valueSource: 'unknown',
      action: { type: 'toggle-command' }
    })
  })

  it('hands Codex model changes to the TUI picker and drops stale truth', async () => {
    seedNativeChatAppliedSessionOptions('pty-1', 'codex', {
      model: 'gpt-5.5',
      effort: 'high'
    })
    const dispatch = vi.fn()
    const onAgentPicker = vi.fn()
    const surface = createNativeChatPtySessionOptions({
      agent: 'codex',
      scopeKey: 'pty-1',
      mode: 'live',
      dispatchCommand: dispatch,
      onAgentPicker
    })!
    expect(surface.getSnapshot().find(({ id }) => id === 'effort')?.action?.type).toBe(
      'agent-picker'
    )

    const result = await surface.setOption('effort', 'xhigh')
    expect(dispatch).toHaveBeenCalledWith('/model')
    expect(onAgentPicker).toHaveBeenCalledOnce()
    expect(result.snapshot).toHaveLength(1)
    expect(result.snapshot[0]).toMatchObject({ valueSource: 'unknown' })
  })

  it('tracks typed direct commands and downgrades typed toggles', () => {
    seedNativeChatAppliedSessionOptions('pty-1', 'claude', {
      model: 'sonnet',
      effort: 'high'
    })
    const surface = createNativeChatPtySessionOptions({
      agent: 'claude',
      scopeKey: 'pty-1',
      mode: 'live',
      dispatchCommand: vi.fn()
    })!
    surface.recordOutgoingCommand('/model opus')
    expect(surface.getSnapshot().map(({ id }) => id)).toEqual(['model', 'effort', 'fastMode'])
    expect(surface.getSnapshot()[0]).toMatchObject({
      valueSource: 'dispatched',
      kind: { currentValue: 'opus' }
    })
    surface.recordOutgoingCommand('/fast')
    expect(surface.getSnapshot().find(({ id }) => id === 'fastMode')).toMatchObject({
      valueSource: 'unknown'
    })
  })

  it('drops stale model-scoped truth when typed model commands switch away and back', () => {
    seedNativeChatAppliedSessionOptions('pty-1', 'claude', {
      model: 'opus',
      effort: 'xhigh'
    })
    const surface = createNativeChatPtySessionOptions({
      agent: 'claude',
      scopeKey: 'pty-1',
      mode: 'live',
      dispatchCommand: vi.fn()
    })!

    surface.recordOutgoingCommand('/model sonnet')
    surface.recordOutgoingCommand('/model opus')

    const effort = surface.getSnapshot().find(({ id }) => id === 'effort')
    expect(effort).toMatchObject({ valueSource: 'unknown' })
    expect(effort?.kind).not.toHaveProperty('currentValue')
  })

  it('passes an unknown persisted model through as a literal choice', () => {
    seedNativeChatAppliedSessionOptions('pty-1', 'claude', { model: 'future-model' })
    const surface = createNativeChatPtySessionOptions({
      agent: 'claude',
      scopeKey: 'pty-1',
      mode: 'live',
      dispatchCommand: vi.fn()
    })!
    const model = surface.getSnapshot()[0]
    expect(model.kind).toMatchObject({
      currentValue: 'future-model',
      choices: expect.arrayContaining([{ value: 'future-model', label: 'future-model' }])
    })
  })

  it('recomposes Cursor model slugs for live option changes', async () => {
    seedNativeChatAppliedSessionOptions('pty-1', 'cursor', {
      model: 'gpt-5.3-codex',
      effort: 'medium',
      fastMode: true
    })
    const dispatch = vi.fn()
    const surface = createNativeChatPtySessionOptions({
      agent: 'cursor',
      scopeKey: 'pty-1',
      mode: 'live',
      dispatchCommand: dispatch
    })!
    expect(surface.getSnapshot().find(({ id }) => id === 'effort')?.settable).toBe(true)

    await surface.setOption('effort', 'high')

    expect(dispatch).toHaveBeenCalledWith('/model gpt-5.3-codex-high-fast')
    expect(surface.getSnapshot().find(({ id }) => id === 'effort')).toMatchObject({
      valueSource: 'dispatched',
      kind: { currentValue: 'high' }
    })
  })
})

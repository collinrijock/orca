import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAgentCompletionCoordinator } from './agent-completion-coordinator'
import type { RuntimeTerminalProcessInspection } from '@/runtime/runtime-terminal-inspection'

async function flushAsyncTicks(count = 4): Promise<void> {
  for (let i = 0; i < count; i++) {
    await Promise.resolve()
  }
}

function processResult(foregroundProcess: string | null): RuntimeTerminalProcessInspection {
  return { foregroundProcess, hasChildProcesses: foregroundProcess !== null }
}

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolveDeferred!: (value: T) => void
  const promise = new Promise<T>((resolve) => {
    resolveDeferred = resolve
  })
  return { promise, resolve: resolveDeferred }
}

describe('agent completion coordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('clears process evidence after agent exit so later non-agent spinner titles do not notify', async () => {
    let foregroundProcess: string | null = 'codex'
    const dispatchCompletion = vi.fn()
    const coordinator = createAgentCompletionCoordinator({
      paneKey: 'tab-1:leaf-1',
      getPtyId: () => 'pty-1',
      getSettings: () => null,
      inspectProcess: vi.fn(async () => processResult(foregroundProcess)),
      dispatchCompletion,
      isLive: () => true
    })

    coordinator.startProcessTracking()
    vi.advanceTimersByTime(2_000)
    await flushAsyncTicks()

    coordinator.observeTitle('⠋ codex')
    coordinator.observeTitle('codex done')
    expect(dispatchCompletion).toHaveBeenCalledTimes(1)

    foregroundProcess = 'zsh'
    vi.advanceTimersByTime(750)
    await flushAsyncTicks()
    expect(dispatchCompletion).toHaveBeenCalledTimes(1)

    dispatchCompletion.mockClear()
    coordinator.observeTitle('⠋ experimental-agent-observability')
    coordinator.observeTitle('experimental-agent-observability')
    await flushAsyncTicks()

    expect(dispatchCompletion).not.toHaveBeenCalled()
  })

  it('suppresses process-exit backstop after a title completion already notified the turn', async () => {
    let foregroundProcess: string | null = 'codex'
    const dispatchCompletion = vi.fn()
    const coordinator = createAgentCompletionCoordinator({
      paneKey: 'tab-1:leaf-1',
      getPtyId: () => 'pty-1',
      getSettings: () => null,
      inspectProcess: vi.fn(async () => processResult(foregroundProcess)),
      dispatchCompletion,
      isLive: () => true
    })

    coordinator.startProcessTracking()
    vi.advanceTimersByTime(2_000)
    await flushAsyncTicks()

    coordinator.observeTitle('⠋ codex')
    coordinator.observeTitle('codex done')
    foregroundProcess = null
    vi.advanceTimersByTime(750)
    await flushAsyncTicks()

    expect(dispatchCompletion).toHaveBeenCalledTimes(1)
    expect(dispatchCompletion).toHaveBeenCalledWith('codex done')
  })

  it('recognizes hook agent ids even when the binary name differs', () => {
    const dispatchCompletion = vi.fn()
    const coordinator = createAgentCompletionCoordinator({
      paneKey: 'tab-1:leaf-1',
      getPtyId: () => 'pty-1',
      getSettings: () => null,
      inspectProcess: vi.fn(),
      dispatchCompletion,
      isLive: () => true
    })

    coordinator.observeHookStatus({
      state: 'done',
      prompt: '',
      agentType: 'cursor'
    })

    expect(dispatchCompletion).toHaveBeenCalledWith('cursor')
  })

  it('keeps a generic title completion pending long enough for the first remote inspection', async () => {
    const inspection = createDeferred<RuntimeTerminalProcessInspection>()
    const dispatchCompletion = vi.fn()
    const coordinator = createAgentCompletionCoordinator({
      paneKey: 'tab-1:leaf-1',
      getPtyId: () => 'remote:terminal-1',
      getSettings: () => ({ activeRuntimeEnvironmentId: 'env-1' }),
      inspectProcess: vi.fn(() => inspection.promise),
      dispatchCompletion,
      isLive: () => true
    })

    coordinator.observeTitle('⠋ experimental-agent-observability')
    coordinator.observeTitle('experimental-agent-observability')
    vi.advanceTimersByTime(10_500)
    inspection.resolve(processResult('codex'))
    await flushAsyncTicks()

    expect(dispatchCompletion).toHaveBeenCalledWith('experimental-agent-observability')
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentStatusIpcPayload } from '../../../shared/agent-status-types'
import { isPromptReceiptEligible, watchForPromptSubmitReceipt } from './agent-prompt-submit-receipt'

const listeners: ((data: AgentStatusIpcPayload) => void)[] = []
const unsubscribe = vi.fn()
const onSet = vi.fn((callback: (data: AgentStatusIpcPayload) => void) => {
  listeners.push(callback)
  return unsubscribe
})
const claudeStatus = vi.fn()
const codexStatus = vi.fn()

function emit(partial: Partial<AgentStatusIpcPayload>): void {
  const payload = {
    paneKey: 'tab-1:leaf-1',
    tabId: 'tab-1',
    connectionId: null,
    receivedAt: Date.now(),
    stateStartedAt: Date.now(),
    state: 'working',
    prompt: 'Fix failing checks',
    agentType: 'codex',
    hookEventName: 'UserPromptSubmit',
    hasExplicitPrompt: true,
    ...partial
  } as AgentStatusIpcPayload
  for (const listener of listeners.slice()) {
    listener(payload)
  }
}

describe('agent-prompt-submit-receipt', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    listeners.length = 0
    unsubscribe.mockClear()
    onSet.mockClear()
    claudeStatus.mockReset()
    codexStatus.mockReset()
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      api: {
        agentStatus: { onSet },
        agentHooks: { claudeStatus, codexStatus }
      }
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  describe('watchForPromptSubmitReceipt', () => {
    it('resolves true on a matching UserPromptSubmit receipt', async () => {
      const watch = watchForPromptSubmitReceipt({ tabId: 'tab-1', agent: 'codex', since: 1000 })
      emit({ receivedAt: 2000 })
      await expect(watch.result).resolves.toBe(true)
      expect(unsubscribe).toHaveBeenCalledTimes(1)
    })

    it('ignores receipts for other tabs', async () => {
      const watch = watchForPromptSubmitReceipt({
        tabId: 'tab-1',
        agent: 'codex',
        since: 1000,
        timeoutMs: 50
      })
      emit({ tabId: 'tab-2', receivedAt: 2000 })
      await vi.advanceTimersByTimeAsync(50)
      await expect(watch.result).resolves.toBe(false)
    })

    it('ignores non-submit hook events — codex SessionStart also maps to working', async () => {
      const watch = watchForPromptSubmitReceipt({
        tabId: 'tab-1',
        agent: 'codex',
        since: 1000,
        timeoutMs: 50
      })
      emit({ hookEventName: 'SessionStart', hasExplicitPrompt: undefined, receivedAt: 2000 })
      emit({ hookEventName: 'PreToolUse', hasExplicitPrompt: undefined, receivedAt: 2000 })
      await vi.advanceTimersByTimeAsync(50)
      await expect(watch.result).resolves.toBe(false)
    })

    it('ignores submits without an explicit prompt (harness-injected turns)', async () => {
      const watch = watchForPromptSubmitReceipt({
        tabId: 'tab-1',
        agent: 'codex',
        since: 1000,
        timeoutMs: 50
      })
      emit({ hasExplicitPrompt: undefined, receivedAt: 2000 })
      await vi.advanceTimersByTimeAsync(50)
      await expect(watch.result).resolves.toBe(false)
    })

    it('ignores receipts from before the watch (minus clock slack)', async () => {
      const watch = watchForPromptSubmitReceipt({
        tabId: 'tab-1',
        agent: 'codex',
        since: 10_000,
        timeoutMs: 50
      })
      emit({ receivedAt: 1000 })
      await vi.advanceTimersByTimeAsync(50)
      await expect(watch.result).resolves.toBe(false)
    })

    it('ignores receipts from a different agent on the same tab', async () => {
      const watch = watchForPromptSubmitReceipt({
        tabId: 'tab-1',
        agent: 'claude',
        since: 1000,
        timeoutMs: 50
      })
      emit({ agentType: 'codex', receivedAt: 2000 })
      await vi.advanceTimersByTimeAsync(50)
      await expect(watch.result).resolves.toBe(false)
    })

    it('resolves false on timeout and unsubscribes', async () => {
      const watch = watchForPromptSubmitReceipt({
        tabId: 'tab-1',
        agent: 'codex',
        since: 1000,
        timeoutMs: 100
      })
      await vi.advanceTimersByTimeAsync(100)
      await expect(watch.result).resolves.toBe(false)
      expect(unsubscribe).toHaveBeenCalledTimes(1)
    })

    it('cancel resolves false immediately', async () => {
      const watch = watchForPromptSubmitReceipt({ tabId: 'tab-1', agent: 'codex', since: 1000 })
      watch.cancel()
      await expect(watch.result).resolves.toBe(false)
      expect(unsubscribe).toHaveBeenCalledTimes(1)
    })
  })

  describe('isPromptReceiptEligible', () => {
    it('requires the managed hook service to be installed', async () => {
      claudeStatus.mockResolvedValue({ state: 'installed' })
      await expect(isPromptReceiptEligible('claude')).resolves.toBe(true)

      codexStatus.mockResolvedValue({ state: 'not_installed' })
      await expect(isPromptReceiptEligible('codex')).resolves.toBe(false)

      codexStatus.mockResolvedValue({ state: 'error' })
      await expect(isPromptReceiptEligible('codex')).resolves.toBe(false)
    })

    it('is false for agents outside the verified set and on status failures', async () => {
      await expect(isPromptReceiptEligible('grok')).resolves.toBe(false)
      await expect(isPromptReceiptEligible(undefined)).resolves.toBe(false)
      claudeStatus.mockRejectedValue(new Error('ipc down'))
      await expect(isPromptReceiptEligible('claude')).resolves.toBe(false)
    })
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __getAgentStatusBootstrapQueueLengthForTests as queueLength,
  BOOTSTRAP_QUEUE_MAX,
  drainAgentStatusBootstrapQueue,
  enqueueAgentStatusBootstrap,
  isBootstrapQueueDrained,
  resetAgentStatusBootstrapQueue
} from './agent-status-bootstrap-queue'
import type { ParsedAgentStatusPayload } from '../../../shared/agent-status-types'

const PAYLOAD: ParsedAgentStatusPayload = {
  state: 'done',
  prompt: 'p',
  agentType: 'claude'
}

beforeEach(() => {
  resetAgentStatusBootstrapQueue()
})

describe('agent-status bootstrap queue', () => {
  it('enqueues until drained, then drops post-drain entries', () => {
    expect(
      enqueueAgentStatusBootstrap({ paneKey: 'tab-a:0', payload: PAYLOAD, title: undefined })
    ).toBe(true)
    expect(queueLength()).toBe(1)

    const visitor = vi.fn()
    drainAgentStatusBootstrapQueue(visitor)
    expect(visitor).toHaveBeenCalledTimes(1)
    expect(visitor).toHaveBeenCalledWith({
      paneKey: 'tab-a:0',
      payload: PAYLOAD,
      title: undefined
    })
    expect(isBootstrapQueueDrained()).toBe(true)

    // Post-drain enqueue is a no-op so the renderer's normal "unknown tab"
    // drop path takes over for genuine orphans (closed tabs).
    expect(
      enqueueAgentStatusBootstrap({ paneKey: 'tab-b:0', payload: PAYLOAD, title: undefined })
    ).toBe(false)
    expect(queueLength()).toBe(0)
  })

  it('drain is idempotent', () => {
    enqueueAgentStatusBootstrap({ paneKey: 'tab-a:0', payload: PAYLOAD, title: undefined })
    const visitor = vi.fn()
    drainAgentStatusBootstrapQueue(visitor)
    drainAgentStatusBootstrapQueue(visitor)
    expect(visitor).toHaveBeenCalledTimes(1)
  })

  it('drops new entries when capped (preserves the head — earliest entries win under overflow)', () => {
    for (let i = 0; i < BOOTSTRAP_QUEUE_MAX; i++) {
      expect(
        enqueueAgentStatusBootstrap({ paneKey: `tab-${i}:0`, payload: PAYLOAD, title: undefined })
      ).toBe(true)
    }
    expect(queueLength()).toBe(BOOTSTRAP_QUEUE_MAX)
    expect(
      enqueueAgentStatusBootstrap({ paneKey: 'tab-overflow:0', payload: PAYLOAD, title: undefined })
    ).toBe(false)

    const seen: string[] = []
    drainAgentStatusBootstrapQueue((e) => seen.push(e.paneKey))
    expect(seen).toContain('tab-0:0')
    expect(seen).not.toContain('tab-overflow:0')
  })

  it('reset clears state including the drained flag', () => {
    enqueueAgentStatusBootstrap({ paneKey: 'tab-a:0', payload: PAYLOAD, title: undefined })
    drainAgentStatusBootstrapQueue(() => {})
    expect(isBootstrapQueueDrained()).toBe(true)
    resetAgentStatusBootstrapQueue()
    expect(isBootstrapQueueDrained()).toBe(false)
    // After reset, enqueue is allowed again.
    expect(
      enqueueAgentStatusBootstrap({ paneKey: 'tab-a:0', payload: PAYLOAD, title: undefined })
    ).toBe(true)
  })
})

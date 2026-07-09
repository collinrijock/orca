import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  pasteDraftWhenAgentReady: vi.fn(),
  seedNativeChatLaunchPrompt: vi.fn(),
  markNativeChatLaunchPromptFailed: vi.fn(),
  isPromptReceiptEligible: vi.fn(),
  watchForPromptSubmitReceipt: vi.fn(),
  receiptCancel: vi.fn()
}))

vi.mock('@/lib/agent-paste-draft', () => ({
  pasteDraftWhenAgentReady: mocks.pasteDraftWhenAgentReady
}))

vi.mock('@/lib/agent-prompt-submit-receipt', () => ({
  isPromptReceiptEligible: mocks.isPromptReceiptEligible,
  watchForPromptSubmitReceipt: mocks.watchForPromptSubmitReceipt
}))

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({
      seedNativeChatLaunchPrompt: mocks.seedNativeChatLaunchPrompt,
      markNativeChatLaunchPromptFailed: mocks.markNativeChatLaunchPromptFailed
    })
  }
}))

import { deliverLaunchPromptToAgentTab } from './agent-launch-prompt-delivery'

describe('deliverLaunchPromptToAgentTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.pasteDraftWhenAgentReady.mockResolvedValue(true)
    mocks.isPromptReceiptEligible.mockResolvedValue(false)
    mocks.watchForPromptSubmitReceipt.mockReturnValue({
      result: Promise.resolve(true),
      cancel: mocks.receiptCancel
    })
  })

  it('seeds a native-chat launch prompt for supported submitted content', async () => {
    await expect(
      deliverLaunchPromptToAgentTab({
        tabId: 'tab-1',
        agent: 'codex',
        content: 'Fix failing checks',
        submit: true,
        forcePaste: true
      })
    ).resolves.toBe(true)

    expect(mocks.seedNativeChatLaunchPrompt).toHaveBeenCalledWith({
      tabId: 'tab-1',
      agent: 'codex',
      text: 'Fix failing checks',
      createdAt: expect.any(Number)
    })
    expect(mocks.pasteDraftWhenAgentReady).toHaveBeenCalledWith({
      tabId: 'tab-1',
      agent: 'codex',
      content: 'Fix failing checks',
      submit: true,
      forcePaste: true,
      timeoutMs: undefined,
      onTimeout: undefined
    })
  })

  it('does not seed for drafts, unsupported agents, or empty content', async () => {
    await deliverLaunchPromptToAgentTab({
      tabId: 'draft-tab',
      agent: 'codex',
      content: 'Review first',
      submit: false,
      forcePaste: false
    })
    await deliverLaunchPromptToAgentTab({
      tabId: 'unsupported-tab',
      agent: 'grok',
      content: 'Fix failing checks',
      submit: true,
      forcePaste: true
    })
    await deliverLaunchPromptToAgentTab({
      tabId: 'empty-tab',
      agent: 'claude',
      content: '   ',
      submit: true,
      forcePaste: true
    })

    expect(mocks.seedNativeChatLaunchPrompt).not.toHaveBeenCalled()
  })

  it('marks a seeded launch prompt failed when paste delivery returns false', async () => {
    mocks.pasteDraftWhenAgentReady.mockResolvedValue(false)

    await expect(
      deliverLaunchPromptToAgentTab({
        tabId: 'tab-1',
        agent: 'claude',
        content: 'Large generated prompt',
        submit: true,
        forcePaste: true
      })
    ).resolves.toBe(false)

    expect(mocks.markNativeChatLaunchPromptFailed).toHaveBeenCalledWith('tab-1')
  })

  it('treats native-prefill delivery as success without flagging the seeded prompt', async () => {
    // claude delivers via `--prefill` at launch, so paste no-ops (returns false)
    // when forcePaste is false — that is a native delivery, not a failure.
    mocks.pasteDraftWhenAgentReady.mockResolvedValue(false)

    await expect(
      deliverLaunchPromptToAgentTab({
        tabId: 'tab-1',
        agent: 'claude',
        content: 'Large generated prompt',
        submit: true,
        forcePaste: false
      })
    ).resolves.toBe(true)

    expect(mocks.seedNativeChatLaunchPrompt).toHaveBeenCalled()
    expect(mocks.markNativeChatLaunchPromptFailed).not.toHaveBeenCalled()
  })

  it('does not mark unseeded launches failed', async () => {
    mocks.pasteDraftWhenAgentReady.mockResolvedValue(false)

    await deliverLaunchPromptToAgentTab({
      tabId: 'tab-1',
      agent: 'grok',
      content: 'Large generated prompt',
      submit: true,
      forcePaste: true
    })

    expect(mocks.markNativeChatLaunchPromptFailed).not.toHaveBeenCalled()
  })

  it('passes timeout options through and stamps readiness-timeout as the reason', async () => {
    const onTimeout = vi.fn()

    await deliverLaunchPromptToAgentTab({
      tabId: 'tab-1',
      agent: 'codex',
      content: 'Fix failing checks',
      submit: true,
      forcePaste: true,
      timeoutMs: 123,
      onTimeout
    })

    expect(mocks.pasteDraftWhenAgentReady).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 123, onTimeout: expect.any(Function) })
    )
    const forwarded = mocks.pasteDraftWhenAgentReady.mock.calls[0][0].onTimeout
    forwarded()
    expect(onTimeout).toHaveBeenCalledWith('readiness-timeout')
  })

  describe('prompt-submit receipt gating', () => {
    it('confirms delivery only after the hook receipt arrives', async () => {
      mocks.isPromptReceiptEligible.mockResolvedValue(true)

      await expect(
        deliverLaunchPromptToAgentTab({
          tabId: 'tab-1',
          agent: 'codex',
          content: 'Fix failing checks',
          submit: true,
          forcePaste: true
        })
      ).resolves.toBe(true)

      expect(mocks.watchForPromptSubmitReceipt).toHaveBeenCalledWith({
        tabId: 'tab-1',
        agent: 'codex',
        since: expect.any(Number)
      })
      expect(mocks.markNativeChatLaunchPromptFailed).not.toHaveBeenCalled()
    })

    it('fails with receipt-timeout when the paste goes in but no receipt arrives', async () => {
      mocks.isPromptReceiptEligible.mockResolvedValue(true)
      mocks.watchForPromptSubmitReceipt.mockReturnValue({
        result: Promise.resolve(false),
        cancel: mocks.receiptCancel
      })
      const onTimeout = vi.fn()

      await expect(
        deliverLaunchPromptToAgentTab({
          tabId: 'tab-1',
          agent: 'codex',
          content: 'Fix failing checks',
          submit: true,
          forcePaste: true,
          onTimeout
        })
      ).resolves.toBe(false)

      expect(onTimeout).toHaveBeenCalledWith('receipt-timeout')
      expect(mocks.markNativeChatLaunchPromptFailed).toHaveBeenCalledWith('tab-1')
    })

    it('cancels the receipt watch when the paste itself fails', async () => {
      mocks.isPromptReceiptEligible.mockResolvedValue(true)
      mocks.pasteDraftWhenAgentReady.mockResolvedValue(false)

      await expect(
        deliverLaunchPromptToAgentTab({
          tabId: 'tab-1',
          agent: 'codex',
          content: 'Fix failing checks',
          submit: true,
          forcePaste: true
        })
      ).resolves.toBe(false)

      expect(mocks.receiptCancel).toHaveBeenCalledTimes(1)
    })

    it('keeps the optimistic verdict for agents without installed managed hooks', async () => {
      mocks.isPromptReceiptEligible.mockResolvedValue(false)

      await expect(
        deliverLaunchPromptToAgentTab({
          tabId: 'tab-1',
          agent: 'grok',
          content: 'Fix failing checks',
          submit: true,
          forcePaste: true
        })
      ).resolves.toBe(true)

      expect(mocks.watchForPromptSubmitReceipt).not.toHaveBeenCalled()
    })

    it('does not require receipts for unsubmitted drafts', async () => {
      mocks.isPromptReceiptEligible.mockResolvedValue(true)

      await deliverLaunchPromptToAgentTab({
        tabId: 'tab-1',
        agent: 'codex',
        content: 'Draft notes',
        submit: false,
        forcePaste: true
      })

      expect(mocks.watchForPromptSubmitReceipt).not.toHaveBeenCalled()
    })
  })
})

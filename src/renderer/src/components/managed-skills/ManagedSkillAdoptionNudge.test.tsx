// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ManagedSkillAdoptionNudge } from './ManagedSkillAdoptionNudge'

const mocks = vi.hoisted(() => ({
  dismiss: vi.fn(async () => {}),
  info: vi.fn(),
  openSettingsPage: vi.fn(),
  openSettingsTarget: vi.fn(),
  inventory: {
    schemaVersion: 1,
    hostId: 'local',
    installations: [
      {
        id: 'candidate-a',
        hostId: 'local',
        physicalIdentity: '1:1',
        name: 'orca-cli',
        installedPackageDigest: 'a'.repeat(64),
        adoptionPromptEligible: true
      },
      {
        id: 'candidate-b',
        hostId: 'local',
        physicalIdentity: '1:2',
        name: 'orchestration',
        installedPackageDigest: 'b'.repeat(64),
        adoptionPromptEligible: false
      }
    ],
    adoptionCandidateCount: 1,
    scannedAt: 1
  }
}))

vi.mock('sonner', () => ({ toast: { info: mocks.info } }))
vi.mock('@/hooks/useManagedAgentSkills', () => ({
  useManagedAgentSkills: () => ({ inventory: mocks.inventory, dismiss: mocks.dismiss })
}))
vi.mock('@/store', () => ({
  useAppStore: (selector: (state: unknown) => unknown) =>
    selector({
      openSettingsPage: mocks.openSettingsPage,
      openSettingsTarget: mocks.openSettingsTarget
    })
}))

describe('ManagedSkillAdoptionNudge', () => {
  beforeEach(() => {
    mocks.dismiss.mockReset()
    mocks.dismiss.mockResolvedValue(undefined)
    mocks.info.mockClear()
    mocks.openSettingsPage.mockClear()
    mocks.openSettingsTarget.mockClear()
    mocks.inventory.installations[0]!.installedPackageDigest = 'a'.repeat(64)
    mocks.inventory.installations[0]!.adoptionPromptEligible = true
    mocks.inventory.installations[1]!.adoptionPromptEligible = false
  })

  afterEach(() => {
    document.body.replaceChildren()
  })

  it('persists only displayed tuples once across review and close lifecycles', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => root.render(<ManagedSkillAdoptionNudge />))

    expect(mocks.info).toHaveBeenCalledTimes(1)
    expect(mocks.dismiss).not.toHaveBeenCalled()

    const options = mocks.info.mock.calls[0]?.[1] as {
      action: { onClick: () => void }
      onDismiss: () => void
      onAutoClose: () => void
    }
    await act(async () => options.action.onClick())
    await act(async () => options.onDismiss())
    await act(async () => options.onAutoClose())
    await vi.waitFor(() =>
      expect(mocks.dismiss).toHaveBeenCalledWith(mocks.inventory.installations[0])
    )
    expect(mocks.dismiss).toHaveBeenCalledTimes(1)
    expect(mocks.dismiss).not.toHaveBeenCalledWith(mocks.inventory.installations[1])
    root.unmount()
  })

  it('stays suppressed after remount but prompts a different snapshot tuple', async () => {
    const mount = async () => {
      const container = document.createElement('div')
      document.body.appendChild(container)
      const root = createRoot(container)
      await act(async () => root.render(<ManagedSkillAdoptionNudge />))
      return root
    }
    let root = await mount()
    const options = mocks.info.mock.calls[0]?.[1] as { onAutoClose: () => void }
    await act(async () => options.onAutoClose())
    await vi.waitFor(() => expect(mocks.dismiss).toHaveBeenCalledTimes(1))
    root.unmount()

    mocks.info.mockClear()
    mocks.inventory.installations[0]!.adoptionPromptEligible = false
    root = await mount()
    expect(mocks.info).not.toHaveBeenCalled()
    root.unmount()

    mocks.inventory.installations[0]!.installedPackageDigest = 'c'.repeat(64)
    mocks.inventory.installations[0]!.adoptionPromptEligible = true
    root = await mount()
    expect(mocks.info).toHaveBeenCalledTimes(1)
    root.unmount()
  })

  it('dismisses healthy candidates when one persistence call fails and allows retry', async () => {
    mocks.inventory.installations[1]!.adoptionPromptEligible = true
    mocks.dismiss.mockRejectedValueOnce(new Error('disk full'))
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => root.render(<ManagedSkillAdoptionNudge />))
    const options = mocks.info.mock.calls[0]?.[1] as {
      onDismiss: () => void
      onAutoClose: () => void
    }

    await act(async () => options.onAutoClose())
    await vi.waitFor(() => expect(mocks.dismiss).toHaveBeenCalledTimes(2))
    expect(mocks.dismiss).toHaveBeenNthCalledWith(1, mocks.inventory.installations[0])
    expect(mocks.dismiss).toHaveBeenNthCalledWith(2, mocks.inventory.installations[1])
    await act(async () => options.onDismiss())
    await vi.waitFor(() => expect(mocks.dismiss).toHaveBeenCalledTimes(3))
    expect(mocks.dismiss).toHaveBeenNthCalledWith(3, mocks.inventory.installations[0])
    root.unmount()
  })
})

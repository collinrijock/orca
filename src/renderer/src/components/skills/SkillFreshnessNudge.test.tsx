// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SkillFreshnessInstallation } from '../../../../shared/skill-freshness'
import { SkillFreshnessNudge } from './SkillFreshnessNudge'

const mocks = vi.hoisted(() => ({
  dismissed: [] as string[],
  openSkillsPage: vi.fn(),
  updateSettings: vi.fn(),
  toastInfo: vi.fn(),
  requestTerminal: vi.fn(),
  settingsLoaded: true
}))

const outdated: SkillFreshnessInstallation = {
  id: 'orca-cli',
  name: 'orca-cli',
  description: null,
  rootId: 'home-agents',
  providers: ['agent-skills'],
  sourceKind: 'home',
  sourceLabel: 'Agent skills home',
  unresolvedPath: '/home/.agents/skills/orca-cli',
  resolvedPath: '/home/.agents/skills/orca-cli',
  physicalIdentity: 'physical-orca-cli',
  topology: 'canonical-copy',
  status: 'outdated',
  installedReleaseRevision: 1,
  installedAppVersion: '1.0.0',
  currentReleaseRevision: 2,
  currentPackageDigest: 'current',
  currentAppVersion: '2.0.0',
  observedPackageDigest: 'old',
  errorCategory: null
}

vi.mock('@/hooks/useSkillFreshness', () => ({
  useSkillFreshness: () => ({
    inventory: {
      schemaVersion: 1,
      installations: [outdated],
      eligibleUpdateNames: ['orca-cli'],
      scannedAt: 1
    },
    loading: false,
    error: null,
    refresh: vi.fn()
  })
}))

vi.mock('sonner', () => ({
  toast: { info: mocks.toastInfo }
}))

vi.mock('./skill-freshness-update-terminal', () => ({
  requestSkillFreshnessUpdateTerminal: mocks.requestTerminal
}))

vi.mock('@/store', () => {
  const state = () => ({
    settings: mocks.settingsLoaded ? { dismissedSkillFreshnessNudges: mocks.dismissed } : null,
    openSkillsPage: mocks.openSkillsPage,
    updateSettings: mocks.updateSettings
  })
  const useAppStore = (selector: (value: ReturnType<typeof state>) => unknown) => selector(state())
  useAppStore.getState = state
  return { useAppStore }
})

let root: Root | null = null
let container: HTMLDivElement | null = null

async function renderNudge(): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(<SkillFreshnessNudge />)
  })
}

describe('SkillFreshnessNudge', () => {
  beforeEach(() => {
    mocks.dismissed = []
    mocks.settingsLoaded = true
    mocks.openSkillsPage.mockReset()
    mocks.updateSettings.mockReset()
    mocks.updateSettings.mockResolvedValue(undefined)
    mocks.toastInfo.mockReset()
    mocks.requestTerminal.mockReset()
  })

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount())
    }
    root = null
    container?.remove()
    container = null
  })

  it('shows one actionable nudge and persists its exact placement/revision once', async () => {
    await renderNudge()

    expect(mocks.toastInfo).toHaveBeenCalledTimes(1)
    const options = mocks.toastInfo.mock.calls[0]?.[1]
    options.action.onClick()
    options.onAutoClose()

    expect(mocks.requestTerminal).toHaveBeenCalledTimes(1)
    expect(mocks.openSkillsPage).toHaveBeenCalledTimes(1)
    expect(mocks.updateSettings).toHaveBeenCalledTimes(1)
    expect(mocks.updateSettings).toHaveBeenCalledWith({
      dismissedSkillFreshnessNudges: [['physical-orca-cli', 'orca-cli', '2'].join('\0')]
    })
  })

  it('does not repeat a nudge for an already dismissed exact tuple', async () => {
    mocks.dismissed = [['physical-orca-cli', 'orca-cli', '2'].join('\0')]

    await renderNudge()

    expect(mocks.toastInfo).not.toHaveBeenCalled()
  })

  it('waits for persisted settings before deciding whether to nudge', async () => {
    mocks.settingsLoaded = false

    await renderNudge()

    expect(mocks.toastInfo).not.toHaveBeenCalled()
  })
})

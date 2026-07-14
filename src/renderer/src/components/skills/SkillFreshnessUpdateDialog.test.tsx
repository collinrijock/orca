// @vitest-environment happy-dom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  SkillFreshnessInstallation,
  SkillFreshnessInventory
} from '../../../../shared/skill-freshness'
import { SkillFreshnessUpdateDialog } from './SkillFreshnessUpdateDialog'
import {
  consumeSkillFreshnessUpdateDialogRequest,
  requestSkillFreshnessUpdateDialog
} from './skill-freshness-update-dialog'

const mocks = vi.hoisted(() => ({
  inventory: null as SkillFreshnessInventory | null,
  loading: false,
  refresh: vi.fn(),
  terminalProps: [] as { command: string; description: string }[],
  notifyChanged: vi.fn()
}))

vi.mock('@/hooks/useSkillFreshness', () => ({
  useSkillFreshness: () => ({
    inventory: mocks.inventory,
    loading: mocks.loading,
    error: null,
    refresh: mocks.refresh
  })
}))

vi.mock('@/hooks/useInstalledAgentSkills', () => ({
  notifyInstalledAgentSkillsChanged: mocks.notifyChanged
}))

vi.mock('@/components/onboarding/OnboardingInlineCommandTerminal', () => ({
  OnboardingInlineCommandTerminal: (props: { command: string; description: string }) => {
    mocks.terminalProps.push(props)
    return <div data-testid="update-terminal">{props.command}</div>
  }
}))

// Radix Dialog/Collapsible internals (portal, focus-scope) are exercised in
// Electron QA; here the content logic is what matters, so use plain wrappers.
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) =>
    open ? <div data-dialog-open="true">{children}</div> : null,
  DialogContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>
}))

vi.mock('@/components/ui/collapsible', () => ({
  Collapsible: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  CollapsibleTrigger: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  CollapsibleContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>
}))

function placement(
  name: string,
  overrides: Partial<SkillFreshnessInstallation> = {}
): SkillFreshnessInstallation {
  return {
    id: `${name}-${overrides.rootId ?? 'home-agents'}`,
    name,
    description: null,
    rootId: 'home-agents',
    providers: ['agent-skills'],
    sourceKind: 'home',
    sourceLabel: 'Agent skills home',
    unresolvedPath: `/home/.agents/skills/${name}`,
    resolvedPath: `/home/.agents/skills/${name}`,
    physicalIdentity: `physical-${name}`,
    topology: 'canonical-copy',
    status: 'outdated',
    installedReleaseRevision: 1,
    installedAppVersion: '1.0.0',
    currentReleaseRevision: 2,
    currentPackageDigest: 'current',
    currentAppVersion: '2.0.0',
    observedPackageDigest: 'old',
    errorCategory: null,
    ...overrides
  }
}

function eligibleInventory(): SkillFreshnessInventory {
  return {
    schemaVersion: 1,
    installations: [placement('orca-cli')],
    eligibleUpdateNames: ['orca-cli'],
    scannedAt: 1
  }
}

let root: Root | null = null
let container: HTMLDivElement | null = null

async function renderDialog(): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(<SkillFreshnessUpdateDialog />)
  })
}

async function rerender(): Promise<void> {
  await act(async () => {
    root?.render(<SkillFreshnessUpdateDialog />)
  })
}

async function openViaRequest(): Promise<void> {
  await act(async () => {
    requestSkillFreshnessUpdateDialog()
  })
}

async function clickButton(label: string): Promise<void> {
  const button = Array.from(container?.querySelectorAll('button') ?? []).find(
    (candidate) => candidate.textContent?.trim() === label
  )
  expect(button).toBeDefined()
  await act(async () => {
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

describe('SkillFreshnessUpdateDialog', () => {
  beforeEach(() => {
    consumeSkillFreshnessUpdateDialogRequest()
    mocks.inventory = eligibleInventory()
    mocks.loading = false
    mocks.refresh.mockReset()
    mocks.notifyChanged.mockReset()
    mocks.terminalProps.length = 0
  })

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount())
    }
    root = null
    container?.remove()
    container = null
  })

  it('stays closed until an open request arrives', async () => {
    await renderDialog()
    expect(container?.querySelector('[data-dialog-open]')).toBeNull()
  })

  it('shows the eligible summary and the exact pre-filled draft command', async () => {
    await renderDialog()
    await openViaRequest()

    expect(container?.textContent).toContain('1 skill can be updated safely')
    expect(container?.textContent).toContain('never writes to skill folders')
    expect(mocks.terminalProps.at(-1)).toMatchObject({
      command: 'npx skills update orca-cli --global',
      description:
        'The targeted command is pre-filled but not running. Review it and press Enter to continue.'
    })
  })

  it('resolves a request made before inventory loads once a safe command arrives', async () => {
    mocks.inventory = null
    await openViaRequest()
    await renderDialog()

    expect(container?.querySelector('[data-dialog-open]')).not.toBeNull()
    expect(mocks.terminalProps).toEqual([])

    mocks.inventory = eligibleInventory()
    await rerender()

    expect(mocks.terminalProps.at(-1)?.command).toBe('npx skills update orca-cli --global')
  })

  it('shows the up-to-date state once every installation is current', async () => {
    await renderDialog()
    await openViaRequest()

    mocks.inventory = {
      schemaVersion: 1,
      installations: [
        placement('orca-cli', { status: 'current', observedPackageDigest: 'current' })
      ],
      eligibleUpdateNames: [],
      scannedAt: 2
    }
    await rerender()

    expect(container?.textContent).toContain('All installed Orca skills are up to date.')
    expect(container?.querySelector('[data-testid="update-terminal"]')).toBeNull()
  })

  it('explains a poisoned sibling in Details without offering a command', async () => {
    mocks.inventory = {
      schemaVersion: 1,
      installations: [
        placement('orca-cli'),
        placement('orca-cli', {
          id: 'repo-copy',
          rootId: 'repo',
          sourceKind: 'repo',
          topology: 'repo-scope',
          status: 'unrecognized',
          unresolvedPath: '/repo/.agents/skills/orca-cli'
        })
      ],
      eligibleUpdateNames: [],
      scannedAt: 1
    }
    await renderDialog()
    await openViaRequest()

    expect(container?.textContent).toContain(
      'another placement of this name prevents a safe global update'
    )
    expect(container?.textContent).toContain('Repository scope')
    expect(container?.querySelector('[data-testid="update-terminal"]')).toBeNull()
  })

  it('explains a self-blocked read-only placement without blaming a sibling', async () => {
    mocks.inventory = {
      schemaVersion: 1,
      installations: [placement('orca-cli', { topology: 'read-only' })],
      eligibleUpdateNames: [],
      scannedAt: 1
    }
    await renderDialog()
    await openViaRequest()

    expect(container?.textContent).toContain('this placement cannot be updated safely in place')
    expect(container?.textContent).not.toContain('another placement of this name')
    expect(container?.textContent).toContain('Read only')
  })

  it('re-inventories installed skills when the dialog closes', async () => {
    await renderDialog()
    await openViaRequest()

    await clickButton('Close')

    expect(mocks.notifyChanged).toHaveBeenCalledTimes(1)
    expect(container?.querySelector('[data-dialog-open]')).toBeNull()
  })

  it('forces a re-check from the Check now affordance', async () => {
    await renderDialog()
    await openViaRequest()

    await clickButton('Check now')

    expect(mocks.refresh).toHaveBeenCalledTimes(1)
  })
})

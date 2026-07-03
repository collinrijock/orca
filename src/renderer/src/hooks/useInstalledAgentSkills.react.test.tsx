// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  DiscoveredSkill,
  SkillDiscoveryResult,
  SkillDiscoveryTarget
} from '../../../shared/skills'
import type { ProjectExecutionRuntimeResolution } from '../../../shared/project-execution-runtime'
import {
  GLOBAL_AGENT_SKILL_SOURCE_KINDS,
  type InstalledAgentSkillState,
  _installedAgentSkillDiscoveryInternalsForTests,
  markAgentSkillInstallCommandCopied,
  useInstalledAgentSkillNames
} from './useInstalledAgentSkills'

let root: Root | null = null
let container: HTMLDivElement | null = null
let latestState: InstalledAgentSkillState | null = null
let latestPrimaryState: InstalledAgentSkillState | null = null
let latestSiblingState: InstalledAgentSkillState | null = null

function skill(overrides: Partial<DiscoveredSkill>): DiscoveredSkill {
  return {
    id: 'skill-1',
    name: 'Example Skill',
    description: null,
    providers: ['agent-skills'],
    sourceKind: 'home',
    sourceLabel: 'Agent skills home',
    rootPath: '/Users/test/.agents/skills',
    directoryPath: '/Users/test/.agents/skills/example-skill',
    skillFilePath: '/Users/test/.agents/skills/example-skill/SKILL.md',
    installed: true,
    fileCount: 1,
    updatedAt: null,
    ...overrides
  }
}

function discoveryResult(skills: DiscoveredSkill[] = []): SkillDiscoveryResult {
  return {
    skills,
    sources: [],
    scannedAt: Date.now()
  }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const LINEAR_AGENT_SKILL_NAMES = ['orca-linear', 'linear-tickets'] as const

const projectWslRuntime: ProjectExecutionRuntimeResolution = {
  status: 'resolved',
  runtime: {
    kind: 'wsl',
    hostPlatform: 'wsl',
    projectId: 'repo-1',
    distro: 'Ubuntu',
    reason: 'project-override',
    cacheKey: 'repo-1:wsl:Ubuntu'
  }
}

function Probe({ discoveryTarget }: { discoveryTarget?: SkillDiscoveryTarget }): null {
  latestState = useInstalledAgentSkillNames(LINEAR_AGENT_SKILL_NAMES, {
    discoveryTarget,
    sourceKinds: GLOBAL_AGENT_SKILL_SOURCE_KINDS
  })
  return null
}

function SiblingProbe(): null {
  latestPrimaryState = useInstalledAgentSkillNames(['orca-cli'], {
    sourceKinds: GLOBAL_AGENT_SKILL_SOURCE_KINDS
  })
  latestSiblingState = useInstalledAgentSkillNames(['computer-use'], {
    sourceKinds: GLOBAL_AGENT_SKILL_SOURCE_KINDS
  })
  return null
}

async function renderProbe(discoveryTarget?: SkillDiscoveryTarget): Promise<void> {
  if (!container) {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  }
  await act(async () => {
    root?.render(<Probe discoveryTarget={discoveryTarget} />)
  })
}

async function renderSiblingProbe(): Promise<void> {
  if (!container) {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  }
  await act(async () => {
    root?.render(<SiblingProbe />)
  })
}

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount()
    })
  }
  root = null
  container?.remove()
  container = null
  latestState = null
  latestPrimaryState = null
  latestSiblingState = null
  _installedAgentSkillDiscoveryInternalsForTests.reset()
  vi.restoreAllMocks()
  Reflect.deleteProperty(window, 'api')
})

describe('useInstalledAgentSkill', () => {
  it('ignores stale discovery results after the discovery target changes', async () => {
    const hostScan = deferred<SkillDiscoveryResult>()
    const wslScan = deferred<SkillDiscoveryResult>()
    const discover = vi
      .fn<(target?: SkillDiscoveryTarget) => Promise<SkillDiscoveryResult>>()
      .mockReturnValueOnce(hostScan.promise)
      .mockReturnValueOnce(wslScan.promise)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { skills: { discover } }
    })

    await renderProbe()
    await renderProbe({ runtime: 'wsl', wslDistro: 'Fedora' })

    wslScan.resolve(discoveryResult([]))
    await act(async () => {
      await wslScan.promise
    })

    expect(latestState?.installed).toBe(false)

    hostScan.resolve(discoveryResult([skill({ name: 'linear-tickets' })]))
    await act(async () => {
      await hostScan.promise
    })

    expect(latestState?.installed).toBe(false)
    expect(discover).toHaveBeenNthCalledWith(1, undefined)
    expect(discover).toHaveBeenNthCalledWith(2, { runtime: 'wsl', wslDistro: 'Fedora' })
  })

  it('starts a fresh scan for manual refresh after an in-flight surface scan settles', async () => {
    const surfaceScan = deferred<SkillDiscoveryResult>()
    const forcedScan = deferred<SkillDiscoveryResult>()
    const discover = vi
      .fn<(target?: SkillDiscoveryTarget) => Promise<SkillDiscoveryResult>>()
      .mockReturnValueOnce(surfaceScan.promise)
      .mockReturnValueOnce(forcedScan.promise)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { skills: { discover } }
    })

    await renderProbe()

    const forcedRefresh = latestState?.refresh() ?? Promise.resolve()

    surfaceScan.resolve(discoveryResult([]))
    await act(async () => {
      await surfaceScan.promise
      await Promise.resolve()
    })

    expect(discover).toHaveBeenCalledTimes(2)

    forcedScan.resolve(discoveryResult([skill({ name: 'linear-tickets' })]))
    await act(async () => {
      await forcedRefresh
    })

    await expect(forcedRefresh).resolves.toBe(true)
    expect(latestState?.installed).toBe(true)
    expect(discover).toHaveBeenNthCalledWith(1, undefined)
    expect(discover).toHaveBeenNthCalledWith(2, undefined)
  })

  it('returns installed from refresh when a legacy Linear skill is discovered', async () => {
    const surfaceScan = deferred<SkillDiscoveryResult>()
    const forcedScan = deferred<SkillDiscoveryResult>()
    const discover = vi
      .fn<(target?: SkillDiscoveryTarget) => Promise<SkillDiscoveryResult>>()
      .mockReturnValueOnce(surfaceScan.promise)
      .mockReturnValueOnce(forcedScan.promise)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { skills: { discover } }
    })

    await renderProbe()

    surfaceScan.resolve(discoveryResult([]))
    await act(async () => {
      await surfaceScan.promise
    })

    const forcedRefresh = latestState?.refresh() ?? Promise.resolve(false)
    forcedScan.resolve(discoveryResult([skill({ name: 'linear-tickets' })]))
    let installed = false
    await act(async () => {
      installed = await forcedRefresh
    })

    expect(installed).toBe(true)
    expect(latestState?.installed).toBe(true)
  })

  it('updates sibling hook instances after one hook refreshes discovery', async () => {
    const surfaceScan = deferred<SkillDiscoveryResult>()
    const forcedScan = deferred<SkillDiscoveryResult>()
    const discover = vi
      .fn<(target?: SkillDiscoveryTarget) => Promise<SkillDiscoveryResult>>()
      .mockReturnValueOnce(surfaceScan.promise)
      .mockReturnValueOnce(forcedScan.promise)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { skills: { discover } }
    })

    await renderSiblingProbe()

    const forcedRefresh = latestPrimaryState?.refresh() ?? Promise.resolve(true)
    surfaceScan.resolve(discoveryResult([]))
    await act(async () => {
      await surfaceScan.promise
      await Promise.resolve()
    })

    expect(latestPrimaryState?.loading).toBe(true)
    expect(latestSiblingState?.loading).toBe(true)
    expect(latestPrimaryState?.installed).toBe(false)
    expect(latestSiblingState?.installed).toBe(false)

    forcedScan.resolve(discoveryResult([skill({ name: 'computer-use' })]))
    await act(async () => {
      await forcedRefresh
    })

    expect(latestPrimaryState?.installed).toBe(false)
    expect(latestSiblingState?.installed).toBe(true)
    expect(discover).toHaveBeenCalledTimes(2)
  })

  it('clears sibling hook loading when a post-pending refresh fails', async () => {
    const surfaceScan = deferred<SkillDiscoveryResult>()
    const forcedScan = deferred<SkillDiscoveryResult>()
    const discover = vi
      .fn<(target?: SkillDiscoveryTarget) => Promise<SkillDiscoveryResult>>()
      .mockReturnValueOnce(surfaceScan.promise)
      .mockReturnValueOnce(forcedScan.promise)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { skills: { discover } }
    })

    await renderSiblingProbe()

    const forcedRefresh = latestPrimaryState?.refresh() ?? Promise.resolve(true)
    surfaceScan.resolve(discoveryResult([]))
    await act(async () => {
      await surfaceScan.promise
      await Promise.resolve()
    })

    expect(latestPrimaryState?.loading).toBe(true)
    expect(latestSiblingState?.loading).toBe(true)

    forcedScan.reject(new Error('scan failed'))
    await act(async () => {
      await forcedRefresh
      await Promise.resolve()
    })

    expect(latestPrimaryState?.loading).toBe(false)
    expect(latestSiblingState?.loading).toBe(false)
    expect(latestPrimaryState?.error).toBe('scan failed')
    expect(latestSiblingState?.error).toBe('scan failed')
    expect(discover).toHaveBeenCalledTimes(2)
  })

  it('rescans on the next window focus after an install command copy', async () => {
    const discover = vi
      .fn<(target?: SkillDiscoveryTarget) => Promise<SkillDiscoveryResult>>()
      .mockResolvedValueOnce(discoveryResult([]))
      .mockResolvedValueOnce(discoveryResult([skill({ name: 'linear-tickets' })]))
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { skills: { discover } }
    })

    await renderProbe()
    await act(async () => {
      await Promise.resolve()
    })
    expect(discover).toHaveBeenCalledTimes(1)
    expect(latestState?.installed).toBe(false)

    markAgentSkillInstallCommandCopied()
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(discover).toHaveBeenCalledTimes(2)
    expect(latestState?.installed).toBe(true)

    // Why: only a copy arms the rescan — plain focus churn must stay scan-free.
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      await Promise.resolve()
    })
    expect(discover).toHaveBeenCalledTimes(2)
  })

  it('does not rescan when a re-render passes a new same-key discovery target object', async () => {
    const discover = vi
      .fn<(target?: SkillDiscoveryTarget) => Promise<SkillDiscoveryResult>>()
      .mockResolvedValue(discoveryResult([skill({ name: 'linear-tickets' })]))
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { skills: { discover } }
    })

    await renderProbe({ runtime: 'wsl', wslDistro: 'Ubuntu' })
    await act(async () => {
      await Promise.resolve()
    })
    // Why: callers rebuild the target object on every store churn; only a KEY
    // change may trigger another forced disk scan.
    await renderProbe({ runtime: 'wsl', wslDistro: 'Ubuntu' })
    await act(async () => {
      await Promise.resolve()
    })

    expect(discover).toHaveBeenCalledTimes(1)
    expect(latestState?.installed).toBe(true)
  })

  it('resolves a suppressed refresh from the replacement scan result', async () => {
    const mountScan = deferred<SkillDiscoveryResult>()
    const firstScan = deferred<SkillDiscoveryResult>()
    const secondScan = deferred<SkillDiscoveryResult>()
    const discover = vi
      .fn<(target?: SkillDiscoveryTarget) => Promise<SkillDiscoveryResult>>()
      .mockReturnValueOnce(mountScan.promise)
      .mockReturnValueOnce(firstScan.promise)
      .mockReturnValueOnce(secondScan.promise)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { skills: { discover } }
    })

    await renderProbe()
    mountScan.resolve(discoveryResult([]))
    await act(async () => {
      await mountScan.promise
    })

    // Why: the first refresh starts scan #2; the second suppresses it and
    // starts scan #3. Both callers must report scan #3's truth — the first
    // previously resolved false and misreported an installed skill.
    const firstRefresh = latestState?.refresh() ?? Promise.resolve(false)
    const secondRefresh = latestState?.refresh() ?? Promise.resolve(false)

    firstScan.resolve(discoveryResult([]))
    await act(async () => {
      await firstScan.promise
      await Promise.resolve()
    })

    secondScan.resolve(discoveryResult([skill({ name: 'linear-tickets' })]))
    await act(async () => {
      await Promise.all([firstRefresh, secondRefresh])
    })

    await expect(firstRefresh).resolves.toBe(true)
    await expect(secondRefresh).resolves.toBe(true)
    expect(latestState?.installed).toBe(true)
    expect(discover).toHaveBeenCalledTimes(3)
  })

  it('detects a legacy Linear install through WSL skill discovery', async () => {
    const discover = vi
      .fn<(target?: SkillDiscoveryTarget) => Promise<SkillDiscoveryResult>>()
      .mockResolvedValue(discoveryResult([skill({ name: 'linear-tickets' })]))
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { skills: { discover } }
    })

    await renderProbe({ runtime: 'wsl', wslDistro: 'Ubuntu' })
    await act(async () => {
      await Promise.resolve()
    })

    expect(latestState?.installed).toBe(true)
    expect(discover).toHaveBeenCalledWith({ runtime: 'wsl', wslDistro: 'Ubuntu' })
  })

  it('detects a legacy Linear install through project-runtime skill discovery', async () => {
    const discover = vi
      .fn<(target?: SkillDiscoveryTarget) => Promise<SkillDiscoveryResult>>()
      .mockResolvedValue(discoveryResult([skill({ name: 'linear-tickets' })]))
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { skills: { discover } }
    })

    await renderProbe({ projectRuntime: projectWslRuntime })
    await act(async () => {
      await Promise.resolve()
    })

    expect(latestState?.installed).toBe(true)
    expect(discover).toHaveBeenCalledWith({
      runtime: 'wsl',
      wslDistro: 'Ubuntu',
      projectRuntime: projectWslRuntime
    })
  })
})

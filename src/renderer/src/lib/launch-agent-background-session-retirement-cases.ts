import { expect, it, vi } from 'vitest'

type TestMock = ReturnType<typeof vi.fn>

type RetirementCaseHarness = {
  state: {
    settings: {
      agentCmdOverrides: Record<string, string>
      activeRuntimeEnvironmentId: string | null
      terminalMainSideEffectAuthority: boolean | undefined
    }
    tabsByWorktree: Record<string, { id: string; title: string }[]>
  }
  mockSpawn: TestMock
  mockCreateTab: TestMock
  mockKill: TestMock
  mockUpdateTabPtyId: TestMock
  mockSubscribeToPtyData: TestMock
  mockDispatchEvent: TestMock
  mockRuntimeEnvironmentCall: TestMock
  mockRuntimeEnvironmentSubscribe: TestMock
}

export function registerLaunchAgentBackgroundSessionRetirementCases(
  harness: RetirementCaseHarness
): void {
  const {
    state,
    mockSpawn,
    mockCreateTab,
    mockKill,
    mockUpdateTabPtyId,
    mockSubscribeToPtyData,
    mockDispatchEvent,
    mockRuntimeEnvironmentCall,
    mockRuntimeEnvironmentSubscribe
  } = harness

  it('kills a local PTY when its tab closes before spawn resolves', async () => {
    let resolveSpawn!: (result: { id: string }) => void
    mockSpawn.mockReturnValueOnce(
      new Promise<{ id: string }>((resolve) => {
        resolveSpawn = resolve
      })
    )
    const { launchAgentBackgroundSession } = await import('./launch-agent-background-session')

    const launch = launchAgentBackgroundSession({
      agent: 'claude',
      worktreeId: 'wt-1',
      prompt: 'run slowly'
    })
    await vi.waitFor(() => expect(mockCreateTab).toHaveBeenCalledOnce())
    state.tabsByWorktree['wt-1'] = []
    resolveSpawn({ id: 'pty-after-close' })

    await expect(launch).resolves.toBeNull()
    expect(mockKill).toHaveBeenCalledWith('pty-after-close')
    expect(mockUpdateTabPtyId).not.toHaveBeenCalled()
    expect(mockSubscribeToPtyData).not.toHaveBeenCalled()
    expect(mockDispatchEvent).not.toHaveBeenCalled()
  })

  it('closes a runtime terminal when its tab closes before creation resolves', async () => {
    state.settings = {
      agentCmdOverrides: {},
      activeRuntimeEnvironmentId: 'env-1',
      terminalMainSideEffectAuthority: undefined
    }
    let resolveCreate!: (result: {
      ok: true
      result: { terminal: { handle: string; worktreeId: string; title: null } }
    }) => void
    const createResult = new Promise<{
      ok: true
      result: { terminal: { handle: string; worktreeId: string; title: null } }
    }>((resolve) => {
      resolveCreate = resolve
    })
    mockRuntimeEnvironmentCall.mockImplementation((args: { method: string }) => {
      if (args.method === 'terminal.create') {
        return createResult
      }
      return Promise.resolve({ ok: true, result: {} })
    })
    const { launchAgentBackgroundSession } = await import('./launch-agent-background-session')

    const launch = launchAgentBackgroundSession({
      agent: 'claude',
      worktreeId: 'wt-1',
      prompt: 'run remotely'
    })
    await vi.waitFor(() => expect(mockCreateTab).toHaveBeenCalledOnce())
    await vi.waitFor(() =>
      expect(mockRuntimeEnvironmentCall).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'terminal.create' })
      )
    )
    state.tabsByWorktree['wt-1'] = []
    resolveCreate({
      ok: true,
      result: { terminal: { handle: 'terminal-after-close', worktreeId: 'wt-1', title: null } }
    })

    await expect(launch).resolves.toBeNull()
    expect(mockRuntimeEnvironmentCall).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'terminal.close',
        params: { terminal: 'terminal-after-close' }
      })
    )
    expect(mockUpdateTabPtyId).not.toHaveBeenCalled()
    expect(mockRuntimeEnvironmentSubscribe).not.toHaveBeenCalled()
    expect(mockDispatchEvent).not.toHaveBeenCalled()
  })
}

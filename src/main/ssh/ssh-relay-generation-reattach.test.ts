import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SshRelaySession } from './ssh-relay-session'
import { Store } from '../persistence'
import { createMockDeps, mockDeploySuccess } from './ssh-relay-session-test-fixtures'

vi.mock('electron', () => ({
  app: { getPath: () => process.cwd() },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plaintext: string) => Buffer.from(`encrypted:${plaintext}`, 'utf-8'),
    decryptString: (ciphertext: Buffer) => ciphertext.toString('utf-8').slice('encrypted:'.length)
  }
}))

vi.mock('./ssh-relay-deploy', () => ({ deployAndLaunchRelay: vi.fn() }))

vi.mock('./ssh-channel-multiplexer', () => ({
  SshChannelMultiplexer: class MockSshChannelMultiplexer {
    notify = vi.fn()
    request = vi.fn().mockResolvedValue([])
    onNotification = vi.fn().mockReturnValue(() => {})
    onRequest = vi.fn().mockReturnValue(() => {})
    onDispose = vi.fn().mockReturnValue(() => {})
    dispose = vi.fn()
    isDisposed = vi.fn().mockReturnValue(false)
  }
}))

vi.mock('../providers/ssh-pty-provider', () => ({
  isSshPtyNotFoundError: (err: unknown) =>
    (err instanceof Error ? err.message : String(err)).includes('not found'),
  isSshPtyIdentityMismatchError: (err: unknown) =>
    (err instanceof Error ? err.message : String(err)).includes('identity mismatch'),
  SshPtyProvider: class MockSshPtyProvider {
    onData = vi.fn().mockReturnValue(() => {})
    onReplay = vi.fn().mockReturnValue(() => {})
    onExit = vi.fn().mockReturnValue(() => {})
    dispose = vi.fn()
  }
}))

vi.mock('../providers/ssh-filesystem-provider', () => ({
  SshFilesystemProvider: class MockSshFilesystemProvider {
    dispose = vi.fn()
  }
}))

vi.mock('../providers/ssh-git-provider', () => ({
  SshGitProvider: class MockSshGitProvider {}
}))

vi.mock('../ipc/pty', () => ({
  registerSshPtyProvider: vi.fn(),
  unregisterSshPtyProvider: vi.fn(),
  getSshPtyProvider: vi.fn(),
  getPtyIdsForConnection: vi.fn().mockReturnValue([]),
  clearPtyOwnershipForConnection: vi.fn(),
  clearProviderPtyState: vi.fn(),
  deletePtyOwnership: vi.fn(),
  releasePendingSshShutdown: vi.fn(),
  setPtyOwnership: vi.fn(),
  answerStartupTerminalColorQueriesForPty: vi.fn((_id: string, data: string) => data)
}))

vi.mock('../providers/ssh-filesystem-dispatch', () => ({
  registerSshFilesystemProvider: vi.fn(),
  unregisterSshFilesystemProvider: vi.fn(),
  getSshFilesystemProvider: vi.fn().mockReturnValue({ dispose: vi.fn() })
}))

vi.mock('../providers/ssh-git-dispatch', () => ({
  registerSshGitProvider: vi.fn(),
  unregisterSshGitProvider: vi.fn()
}))

const { getSshPtyProvider, getPtyIdsForConnection, releasePendingSshShutdown, setPtyOwnership } =
  await import('../ipc/pty')

describe('SSH relay generation reattach', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDeploySuccess()
  })

  it('reattaches a durable lease only within the relay generation that minted it', async () => {
    const { mockConn, mockStore, mockPortForward, getMainWindow } = createMockDeps()
    const attachForReconnect = vi.fn().mockResolvedValue({})
    vi.mocked(getSshPtyProvider).mockReturnValue({
      attachForReconnect,
      getRelayInstanceId: () => 'relay-generation',
      dispose: vi.fn()
    } as unknown as ReturnType<typeof getSshPtyProvider>)
    vi.mocked(getPtyIdsForConnection).mockReturnValue([])
    vi.mocked(mockStore.getSshRemotePtyLeases).mockReturnValue([
      {
        targetId: 'target-1',
        ptyId: 'pty-live',
        relayInstanceId: 'relay-generation',
        state: 'detached'
      },
      { targetId: 'target-1', ptyId: 'pty-expired', state: 'expired' }
    ] as ReturnType<typeof mockStore.getSshRemotePtyLeases>)

    const session = new SshRelaySession('target-1', getMainWindow, mockStore, mockPortForward)
    await session.establish(mockConn)

    expect(attachForReconnect).toHaveBeenCalledWith('pty-live')
    expect(attachForReconnect).not.toHaveBeenCalledWith('pty-expired')
    expect(setPtyOwnership).toHaveBeenCalledWith(
      'ssh:target-1@@relay-generation@@pty-live',
      'target-1'
    )
  })

  it('expires an older-generation lease before its recycled relay id can attach', async () => {
    const { mockConn, mockStore, mockPortForward, getMainWindow, mockWindow } = createMockDeps()
    const attachForReconnect = vi.fn()
    vi.mocked(getSshPtyProvider).mockReturnValue({
      attachForReconnect,
      getRelayInstanceId: () => 'relay-current',
      dispose: vi.fn()
    } as unknown as ReturnType<typeof getSshPtyProvider>)
    vi.mocked(getPtyIdsForConnection).mockReturnValue([])
    vi.mocked(mockStore.getSshRemotePtyLeases).mockReturnValue([
      {
        targetId: 'target-1',
        ptyId: 'pty-recycled',
        relayInstanceId: 'relay-old',
        state: 'detached'
      }
    ] as ReturnType<typeof mockStore.getSshRemotePtyLeases>)

    const session = new SshRelaySession('target-1', getMainWindow, mockStore, mockPortForward)
    await session.establish(mockConn)

    expect(attachForReconnect).not.toHaveBeenCalled()
    expect(mockStore.markSshRemotePtyLease).toHaveBeenCalledWith(
      'target-1',
      'ssh:target-1@@relay-old@@pty-recycled',
      'expired'
    )
    expect(releasePendingSshShutdown).toHaveBeenCalledWith('ssh:target-1@@relay-old@@pty-recycled')
    expect(mockWindow.webContents.send).toHaveBeenCalledWith('pty:exit', {
      id: 'ssh:target-1@@relay-old@@pty-recycled',
      code: -1
    })
  })

  it('migrates a legacy lease only after the current relay proves it can attach', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-legacy-ssh-lease-'))
    const dataFile = join(dir, 'state.json')
    const store = new Store({ dataFile })
    const reloadedStores: Store[] = []
    try {
      store.upsertSshRemotePtyLease({
        targetId: 'target-1',
        ptyId: 'pty-legacy',
        state: 'detached'
      })
      const synchronousFlush = vi.spyOn(store, 'flush')
      const { mockConn, mockPortForward, getMainWindow } = createMockDeps()
      const attachForReconnect = vi.fn().mockResolvedValue({})
      vi.mocked(getSshPtyProvider).mockReturnValue({
        attachForReconnect,
        getRelayInstanceId: () => 'relay-current',
        dispose: vi.fn()
      } as unknown as ReturnType<typeof getSshPtyProvider>)
      vi.mocked(getPtyIdsForConnection).mockReturnValue([])

      const session = new SshRelaySession('target-1', getMainWindow, store, mockPortForward)
      await session.establish(mockConn)

      expect(attachForReconnect).toHaveBeenCalledWith('pty-legacy')
      expect(store.getSshRemotePtyLeases('target-1')).toEqual([
        expect.objectContaining({
          ptyId: 'pty-legacy',
          relayInstanceId: 'relay-current',
          state: 'attached',
          lastAttachedAt: expect.any(Number)
        })
      ])
      expect(synchronousFlush).not.toHaveBeenCalled()
      const reloaded = new Store({ dataFile })
      reloadedStores.push(reloaded)
      expect(reloaded.getSshRemotePtyLeases('target-1')[0]).toEqual(
        expect.objectContaining({ relayInstanceId: 'relay-current', state: 'attached' })
      )
    } finally {
      store.flush()
      for (const reloaded of reloadedStores) {
        reloaded.flush()
      }
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('expires a failed legacy identity without adopting the current relay generation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-stale-ssh-lease-'))
    const store = new Store({ dataFile: join(dir, 'state.json') })
    try {
      store.upsertSshRemotePtyLease({
        targetId: 'target-1',
        ptyId: 'pty-recycled',
        state: 'detached'
      })
      const { mockConn, mockPortForward, getMainWindow, mockWindow } = createMockDeps()
      const attachForReconnect = vi
        .fn()
        .mockRejectedValue(new Error('PTY "pty-recycled" not found (identity mismatch)'))
      vi.mocked(getSshPtyProvider).mockReturnValue({
        attachForReconnect,
        getRelayInstanceId: () => 'relay-current',
        dispose: vi.fn()
      } as unknown as ReturnType<typeof getSshPtyProvider>)
      vi.mocked(getPtyIdsForConnection).mockReturnValue([])

      const session = new SshRelaySession('target-1', getMainWindow, store, mockPortForward)
      await session.establish(mockConn)

      expect(store.getSshRemotePtyLeases('target-1')).toEqual([
        expect.objectContaining({ ptyId: 'pty-recycled', state: 'expired' })
      ])
      expect(store.getSshRemotePtyLeases('target-1')[0]?.relayInstanceId).toBeUndefined()
      expect(mockWindow.webContents.send).toHaveBeenCalledWith('pty:exit', {
        id: 'ssh:target-1@@pty-recycled',
        code: -1
      })
      expect(setPtyOwnership).not.toHaveBeenCalledWith(
        'ssh:target-1@@relay-current@@pty-recycled',
        'target-1'
      )
    } finally {
      store.flush()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrcaCloudAuthConfig } from './profile-cloud-auth-config'
import type * as ProfileCloudClient from './profile-cloud-client'
import type { ActiveOrcaProfileState } from './profile-index-store'

const { readMock, saveMock, clearMock, refreshMock, linkMock } = vi.hoisted(() => ({
  readMock: vi.fn(),
  saveMock: vi.fn(),
  clearMock: vi.fn(),
  refreshMock: vi.fn(),
  linkMock: vi.fn()
}))

vi.mock('./profile-cloud-session-store', () => ({
  readOrcaCloudSession: readMock,
  saveOrcaCloudSession: saveMock,
  clearOrcaCloudSession: clearMock
}))

vi.mock('./profile-cloud-client', async (importOriginal) => {
  const original = await importOriginal<typeof ProfileCloudClient>()
  return { ...original, refreshOrcaCloudSession: refreshMock }
})

vi.mock('./profile-cloud-index', () => ({ linkOrcaProfileToCloud: linkMock }))

import { readFreshOrcaCloudSession } from './profile-cloud-session-refresh'

const config = {} as OrcaCloudAuthConfig
const active = { profile: { id: 'profile-1' } } as ActiveOrcaProfileState
const staleSession = {
  accessToken: 'old-access',
  refreshToken: 'one-use-refresh',
  expiresAt: 1,
  organizations: [],
  capabilities: { flags: {}, refreshedAt: 1 }
}

describe('profile cloud session refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    readMock.mockReturnValue({ status: 'found', session: staleSession, persistence: 'memory-only' })
  })

  it('single-flights concurrent rotating refresh-token use per profile and store', async () => {
    let resolveRefresh!: (value: Record<string, unknown>) => void
    refreshMock.mockReturnValue(new Promise((resolve) => (resolveRefresh = resolve)))

    const first = readFreshOrcaCloudSession(config, active, '/data')
    const second = readFreshOrcaCloudSession(config, active, '/data')
    expect(refreshMock).toHaveBeenCalledTimes(1)

    resolveRefresh({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      expiresAt: Date.now() + 600_000,
      organizations: [],
      capabilities: { flags: { 'relay.use': true }, refreshedAt: 2 },
      cloud: { userId: 'user-1' }
    })

    const [firstResult, secondResult] = await Promise.all([first, second])
    expect(firstResult).toEqual(secondResult)
    expect(saveMock).toHaveBeenCalledTimes(1)
    expect(linkMock).toHaveBeenCalledTimes(1)
  })
})

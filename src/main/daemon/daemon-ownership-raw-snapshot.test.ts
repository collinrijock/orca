import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  loadRawDaemonOwnershipSnapshot,
  type RawOwnershipSnapshotFilesystem
} from './daemon-ownership-raw-snapshot'
import { withDaemonOwnershipCommit } from './daemon-ownership-commit'

const LEAF = '11111111-1111-4111-8111-111111111111'

function profile(id: string, initialized?: boolean): Record<string, unknown> {
  return {
    id,
    name: id,
    kind: 'local',
    avatar: { kind: 'initials', initials: id[0].toUpperCase(), color: 'neutral' },
    createdAt: 1,
    updatedAt: 1,
    lastOpenedAt: 1,
    ...(initialized === undefined ? {} : { initialized })
  }
}

function indexState(
  profiles: Record<string, unknown>[],
  activeProfileId = String(profiles[0]?.id)
): Record<string, unknown> {
  return { schemaVersion: 1, activeProfileId, profiles }
}

function legacyState(sessionId: string): Record<string, unknown> {
  return withDaemonOwnershipCommit(
    {
      schemaVersion: 1,
      workspaceSession: {
        tabsByWorktree: {
          workspace: [{ id: `tab-${sessionId}`, ptyId: sessionId }]
        }
      }
    },
    1
  )
}

function currentState(sessionId: string, protocolVersion: number): Record<string, unknown> {
  return withDaemonOwnershipCommit(
    {
      schemaVersion: 1,
      workspaceSession: {
        tabsByWorktree: { workspace: [{ id: 'tab-current', ptyId: sessionId }] },
        terminalLayoutsByTabId: {
          'tab-current': {
            root: { type: 'leaf', leafId: LEAF },
            ptyIdsByLeafId: { [LEAF]: sessionId }
          }
        }
      },
      daemonSessionOwnership: {
        schemaVersion: 1,
        claims: [
          {
            sessionId,
            ownerKind: 'pane',
            workspaceKey: 'workspace',
            ownerId: LEAF,
            provider: 'local-daemon',
            protocolVersion
          }
        ],
        legacyProtectedSessionIds: [],
        bindingProvenanceByPtyId: {
          [sessionId]: { kind: 'local-daemon', protocolVersion }
        },
        projectTransferLineage: []
      }
    },
    1
  )
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value), 'utf8')
}

describe('raw cross-profile daemon ownership snapshot', () => {
  let userDataPath: string

  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'orca-raw-ownership-'))
  })

  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true })
  })

  it('unions indexed, inactive, unindexed, and legacy-root ownership', async () => {
    const index = indexState([profile('active'), profile('inactive')], 'active')
    writeJson(join(userDataPath, 'orca-profile-index.json'), index)
    writeJson(join(userDataPath, 'orca-profile-index.json.bak'), index)
    writeJson(
      join(userDataPath, 'profiles', 'active', 'orca-data.json'),
      currentState('exact-active', 22)
    )
    writeJson(
      join(userDataPath, 'profiles', 'inactive', 'orca-data.json'),
      legacyState('inactive-protected')
    )
    writeJson(
      join(userDataPath, 'profiles', 'unindexed', 'orca-data.json'),
      legacyState('unindexed-protected')
    )
    writeJson(join(userDataPath, 'orca-data.json'), legacyState('legacy-root-protected'))

    const result = await loadRawDaemonOwnershipSnapshot(userDataPath)

    expect(result).toMatchObject({
      status: 'complete',
      claims: { exact: [{ protocolVersion: 22, sessionId: 'exact-active' }] }
    })
    if (result.status === 'complete') {
      expect(new Set(result.claims.legacyProtectedSessionIds)).toEqual(
        new Set(['inactive-protected', 'unindexed-protected', 'legacy-root-protected'])
      )
      expect(result.sourceRevision).toMatch(/^[a-f0-9]{64}$/)
    }
  })

  it('lets an inactive corrupt profile block the shared namespace', async () => {
    writeJson(
      join(userDataPath, 'orca-profile-index.json'),
      indexState([profile('active'), profile('inactive')])
    )
    writeJson(join(userDataPath, 'profiles', 'active', 'orca-data.json'), legacyState('safe'))
    const inactivePath = join(userDataPath, 'profiles', 'inactive', 'orca-data.json')
    mkdirSync(dirname(inactivePath), { recursive: true })
    writeFileSync(inactivePath, '{not-json', 'utf8')

    const result = await loadRawDaemonOwnershipSnapshot(userDataPath)

    expect(result).toMatchObject({
      status: 'incomplete',
      reasons: expect.arrayContaining(['profile-state-malformed-json'])
    })
  })

  it('accepts only an explicitly never-initialized missing profile as empty', async () => {
    writeJson(
      join(userDataPath, 'orca-profile-index.json'),
      indexState([profile('never-used', false)])
    )

    await expect(loadRawDaemonOwnershipSnapshot(userDataPath)).resolves.toMatchObject({
      status: 'complete',
      claims: { exact: [], legacyProtectedSessionIds: [] }
    })

    writeJson(
      join(userDataPath, 'orca-profile-index.json'),
      indexState([profile('unknown-initialization')])
    )
    await expect(loadRawDaemonOwnershipSnapshot(userDataPath)).resolves.toMatchObject({
      status: 'incomplete',
      reasons: expect.arrayContaining(['profile-state-missing'])
    })
  })

  it('does not accept a parseable unversioned backup when the primary is missing', async () => {
    writeJson(join(userDataPath, 'orca-profile-index.json'), indexState([profile('profile-a')]))
    writeJson(
      join(userDataPath, 'profiles', 'profile-a', 'orca-data.json.bak.0'),
      legacyState('backup-only')
    )

    const result = await loadRawDaemonOwnershipSnapshot(userDataPath)

    expect(result).toMatchObject({
      status: 'incomplete',
      reasons: expect.arrayContaining(['state-backup-unverifiable'])
    })
  })

  it('rejects a primary whose ownership projection changed after its commit', async () => {
    writeJson(join(userDataPath, 'orca-profile-index.json'), indexState([profile('profile-a')]))
    const state = legacyState('original-owner')
    ;(state.workspaceSession as { tabsByWorktree: Record<string, unknown[]> }).tabsByWorktree = {
      workspace: [{ id: 'tab-tampered', ptyId: 'tampered-owner' }]
    }
    writeJson(join(userDataPath, 'profiles', 'profile-a', 'orca-data.json'), state)

    await expect(loadRawDaemonOwnershipSnapshot(userDataPath)).resolves.toMatchObject({
      status: 'incomplete',
      reasons: expect.arrayContaining(['state-commit-unverifiable'])
    })
  })

  it('does not use a backup to mask a corrupt primary', async () => {
    writeJson(join(userDataPath, 'orca-profile-index.json'), indexState([profile('profile-a')]))
    const primary = join(userDataPath, 'profiles', 'profile-a', 'orca-data.json')
    mkdirSync(dirname(primary), { recursive: true })
    writeFileSync(primary, '{corrupt', 'utf8')
    writeJson(`${primary}.bak.0`, legacyState('backup-owner'))

    const result = await loadRawDaemonOwnershipSnapshot(userDataPath)

    expect(result).toMatchObject({
      status: 'incomplete',
      reasons: expect.arrayContaining(['profile-state-malformed-json', 'state-backup-unverifiable'])
    })
  })

  it('keeps a stale backup non-authoritative when the primary is valid', async () => {
    writeJson(join(userDataPath, 'orca-profile-index.json'), indexState([profile('profile-a')]))
    const primary = join(userDataPath, 'profiles', 'profile-a', 'orca-data.json')
    writeJson(primary, legacyState('primary-owner'))
    writeFileSync(`${primary}.bak.0`, '{stale-corrupt-backup', 'utf8')

    const result = await loadRawDaemonOwnershipSnapshot(userDataPath)

    expect(result).toMatchObject({
      status: 'complete',
      claims: { legacyProtectedSessionIds: ['primary-owner'] }
    })
  })

  it('rejects malformed primary and backup profile indexes', async () => {
    writeFileSync(join(userDataPath, 'orca-profile-index.json'), '{bad', 'utf8')
    writeFileSync(join(userDataPath, 'orca-profile-index.json.bak'), '{also-bad', 'utf8')

    const result = await loadRawDaemonOwnershipSnapshot(userDataPath)

    expect(result).toMatchObject({
      status: 'incomplete',
      reasons: expect.arrayContaining(['profile-index-malformed', 'profile-index-backup-malformed'])
    })
  })

  it('rejects profile directories when the authoritative index is absent', async () => {
    writeJson(
      join(userDataPath, 'profiles', 'orphan', 'orca-data.json'),
      legacyState('orphan-owner')
    )

    await expect(loadRawDaemonOwnershipSnapshot(userDataPath)).resolves.toMatchObject({
      status: 'incomplete',
      reasons: expect.arrayContaining(['profile-index-missing'])
    })
  })

  it('supports a pre-profile legacy root while refusing a namespace with no sources', async () => {
    writeJson(join(userDataPath, 'orca-data.json'), legacyState('legacy-owner'))
    await expect(loadRawDaemonOwnershipSnapshot(userDataPath)).resolves.toMatchObject({
      status: 'complete',
      claims: { legacyProtectedSessionIds: ['legacy-owner'] }
    })

    rmSync(join(userDataPath, 'orca-data.json'))
    await expect(loadRawDaemonOwnershipSnapshot(userDataPath)).resolves.toMatchObject({
      status: 'incomplete',
      reasons: expect.arrayContaining(['ownership-sources-missing'])
    })
  })

  it('retries a changing directory manifest and returns the stable second capture', async () => {
    const indexPath = join(userDataPath, 'orca-profile-index.json')
    const profileAPath = join(userDataPath, 'profiles', 'a', 'orca-data.json')
    const profileBPath = join(userDataPath, 'profiles', 'b', 'orca-data.json')
    const files = new Map<string, string>([
      [indexPath, JSON.stringify(indexState([profile('a'), profile('b')]))],
      [profileAPath, JSON.stringify(legacyState('pty-a'))],
      [profileBPath, JSON.stringify(legacyState('pty-b'))]
    ])
    let listCall = 0
    const filesystem: RawOwnershipSnapshotFilesystem = {
      readOptionalFile: vi.fn(async (path) => files.get(path) ?? null),
      listProfileDirectories: vi.fn(async () => {
        listCall += 1
        return listCall === 1 ? ['a'] : ['a', 'b']
      })
    }

    const result = await loadRawDaemonOwnershipSnapshot(userDataPath, filesystem)

    expect(result).toMatchObject({ status: 'complete' })
    if (result.status === 'complete') {
      expect(new Set(result.claims.legacyProtectedSessionIds)).toEqual(new Set(['pty-a', 'pty-b']))
    }
    expect(filesystem.listProfileDirectories).toHaveBeenCalledTimes(4)
  })

  it('fails when the source manifest changes on both attempts', async () => {
    const indexPath = join(userDataPath, 'orca-profile-index.json')
    const statePath = join(userDataPath, 'profiles', 'a', 'orca-data.json')
    const files = new Map<string, string>([
      [indexPath, JSON.stringify(indexState([profile('a')]))],
      [statePath, JSON.stringify(legacyState('pty-a'))]
    ])
    let listCall = 0
    const filesystem: RawOwnershipSnapshotFilesystem = {
      readOptionalFile: vi.fn(async (path) => files.get(path) ?? null),
      listProfileDirectories: vi.fn(async () => {
        listCall += 1
        return listCall % 2 === 1 ? ['a'] : ['a', 'transient']
      })
    }

    await expect(loadRawDaemonOwnershipSnapshot(userDataPath, filesystem)).resolves.toEqual({
      status: 'incomplete',
      reasons: ['source-manifest-changed']
    })
  })

  it('fails closed on filesystem enumeration errors', async () => {
    const filesystem: RawOwnershipSnapshotFilesystem = {
      readOptionalFile: vi.fn(async () => {
        throw new Error('permission denied')
      }),
      listProfileDirectories: vi.fn(async () => [])
    }

    await expect(loadRawDaemonOwnershipSnapshot(userDataPath, filesystem)).resolves.toEqual({
      status: 'incomplete',
      reasons: ['filesystem-enumeration-failed']
    })
  })

  it('fails closed when aggregate ownership sources exceed the capture budget', async () => {
    const filesystem: RawOwnershipSnapshotFilesystem = {
      readOptionalFile: vi.fn(async (path) =>
        path.endsWith('orca-profile-index.json') ? '123456789' : null
      ),
      listProfileDirectories: vi.fn(async () => [])
    }

    await expect(
      loadRawDaemonOwnershipSnapshot(userDataPath, filesystem, {
        maxCaptureBytes: 8,
        maxProfiles: 10
      })
    ).resolves.toEqual({
      status: 'incomplete',
      reasons: ['ownership-source-budget-exceeded']
    })
  })

  it('fails closed before reading an unbounded number of profiles', async () => {
    const filesystem: RawOwnershipSnapshotFilesystem = {
      readOptionalFile: vi.fn(async () => null),
      listProfileDirectories: vi.fn(async () => ['a', 'b'])
    }

    await expect(
      loadRawDaemonOwnershipSnapshot(userDataPath, filesystem, {
        maxCaptureBytes: 1024,
        maxProfiles: 1
      })
    ).resolves.toEqual({
      status: 'incomplete',
      reasons: ['ownership-profile-budget-exceeded']
    })
  })

  it('reads ownership files with bounded concurrency', async () => {
    let activeReads = 0
    let maxActiveReads = 0
    const filesystem: RawOwnershipSnapshotFilesystem = {
      readOptionalFile: vi.fn(async () => {
        activeReads += 1
        maxActiveReads = Math.max(maxActiveReads, activeReads)
        await Promise.resolve()
        activeReads -= 1
        return null
      }),
      listProfileDirectories: vi.fn(async () => ['a', 'b'])
    }

    await loadRawDaemonOwnershipSnapshot(userDataPath, filesystem)

    expect(maxActiveReads).toBe(1)
  })
})

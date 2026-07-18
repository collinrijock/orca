import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultPersistedState } from '../../shared/constants'
import {
  createEmptyDaemonSessionOwnershipState,
  type DaemonSessionClaim,
  type DaemonSessionOwnershipState
} from '../../shared/daemon-session-ownership'
import {
  ORCA_PROFILE_INDEX_SCHEMA_VERSION,
  type OrcaProfileIndex
} from '../../shared/orca-profiles'
import type { PersistedState, Repo } from '../../shared/types'
import { toSshExecutionHostId } from '../../shared/execution-host'
import { toAppSshPtyId } from '../../shared/ssh-pty-id'
import { loadRawDaemonOwnershipSnapshot } from '../daemon/daemon-ownership-raw-snapshot'
import { withDaemonOwnershipCommit } from '../daemon/daemon-ownership-commit'
import type * as ProfileProjectStateFile from './profile-project-state-file'

const testState = vi.hoisted(() => ({ dir: '', failWriteAt: 0, writeCount: 0 }))

vi.mock('electron', () => ({ app: { getPath: () => testState.dir } }))
vi.mock('./profile-project-state-file', async () => {
  const actual = await vi.importActual<typeof ProfileProjectStateFile>(
    './profile-project-state-file'
  )
  return {
    ...actual,
    writeProfileState: (...args: Parameters<typeof actual.writeProfileState>) => {
      testState.writeCount += 1
      if (testState.writeCount === testState.failWriteAt) {
        throw new Error(`injected-transfer-write-${testState.writeCount}`)
      }
      return actual.writeProfileState(...args)
    }
  }
})

import { transferOrcaProfileProject } from './profile-project-transfer'
import { recoverCompletedProjectTransfers } from './profile-project-transfer-recovery'

function profile(id: string): OrcaProfileIndex['profiles'][number] {
  return {
    id,
    name: id,
    avatar: { kind: 'initials', initials: id[0].toUpperCase(), color: 'neutral' },
    kind: 'local',
    initialized: true,
    createdAt: 1,
    updatedAt: 1,
    lastOpenedAt: 1
  }
}

function repo(id: string, path: string): Repo {
  return {
    id,
    path,
    displayName: id,
    badgeColor: '#33aa99',
    addedAt: 1,
    kind: 'git',
    connectionId: null
  }
}

function claim(args: {
  sessionId: string
  protocolVersion: number
  workspaceKey: string
  ownerId?: string
}): DaemonSessionClaim {
  return {
    sessionId: args.sessionId,
    protocolVersion: args.protocolVersion,
    workspaceKey: args.workspaceKey,
    ownerId: args.ownerId ?? `owner-${args.sessionId}`,
    ownerKind: 'runtime',
    provider: 'local-daemon'
  }
}

function ownership(claims: DaemonSessionClaim[]): DaemonSessionOwnershipState {
  const state = createEmptyDaemonSessionOwnershipState()
  state.claims = claims
  state.legacyProtectedSessionIds = claims.map(({ sessionId }) => sessionId)
  for (const row of claims) {
    state.bindingProvenanceByPtyId[row.sessionId] = {
      kind: 'local-daemon',
      protocolVersion: row.protocolVersion
    }
  }
  return state
}

function persistedState(args: {
  repos: Repo[]
  ownership?: DaemonSessionOwnershipState
  workspaceSession?: PersistedState['workspaceSession']
}): PersistedState {
  return {
    ...getDefaultPersistedState('/Users/tester'),
    repos: args.repos,
    ...(args.ownership ? { daemonSessionOwnership: args.ownership } : {}),
    ...(args.workspaceSession ? { workspaceSession: args.workspaceSession } : {})
  }
}

function statePath(profileId: string): string {
  return join(testState.dir, 'profiles', profileId, 'orca-data.json')
}

function writeRawState(profileId: string, state: PersistedState): void {
  const path = statePath(profileId)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(withDaemonOwnershipCommit(state, 1), null, 2), 'utf8')
}

function readState(profileId: string): PersistedState {
  return JSON.parse(readFileSync(statePath(profileId), 'utf8')) as PersistedState
}

function moveArgs(mode: 'move' | 'copy' = 'move') {
  return {
    sourceProfileId: 'personal',
    targetProfileId: 'work',
    repoId: 'repo-1',
    mode
  } as const
}

describe('profile project daemon ownership transfer', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'orca-profile-ownership-transfer-'))
    testState.failWriteAt = 0
    testState.writeCount = 0
    const index: OrcaProfileIndex = {
      schemaVersion: ORCA_PROFILE_INDEX_SCHEMA_VERSION,
      activeProfileId: 'personal',
      profiles: [profile('personal'), profile('work')]
    }
    writeFileSync(join(testState.dir, 'orca-profile-index.json'), JSON.stringify(index), 'utf8')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it('moves exact claims while preserving unrelated owners and same ids on other protocols', async () => {
    writeRawState(
      'personal',
      persistedState({
        repos: [repo('repo-1', '/workspace/moved'), repo('repo-source-other', '/workspace/source')],
        ownership: ownership([
          claim({ sessionId: 'shared-session', protocolVersion: 22, workspaceKey: 'repo-1' }),
          claim({
            sessionId: 'source-stays',
            protocolVersion: 24,
            workspaceKey: 'repo-source-other'
          })
        ])
      })
    )
    writeRawState(
      'work',
      persistedState({
        repos: [repo('repo-target-other', '/workspace/target')],
        ownership: ownership([
          claim({
            sessionId: 'shared-session',
            protocolVersion: 23,
            workspaceKey: 'repo-target-other'
          }),
          claim({
            sessionId: 'target-stays',
            protocolVersion: 22,
            workspaceKey: 'repo-target-other'
          })
        ])
      })
    )

    expect(transferOrcaProfileProject(moveArgs(), testState.dir)).toMatchObject({
      status: 'transferred',
      targetRepoId: 'repo-1'
    })

    const source = readState('personal')
    const target = readState('work')
    expect(source.daemonSessionOwnership?.claims).toEqual([
      expect.objectContaining({ sessionId: 'source-stays', protocolVersion: 24 })
    ])
    expect(source.daemonSessionOwnership?.bindingProvenanceByPtyId).toEqual({
      'source-stays': { kind: 'local-daemon', protocolVersion: 24 }
    })
    expect(target.daemonSessionOwnership?.claims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sessionId: 'shared-session', protocolVersion: 22 }),
        expect.objectContaining({ sessionId: 'shared-session', protocolVersion: 23 }),
        expect.objectContaining({ sessionId: 'target-stays', protocolVersion: 22 })
      ])
    )
    expect(target.daemonSessionOwnership?.bindingProvenanceByPtyId['shared-session']).toEqual({
      kind: 'local-daemon',
      protocolVersion: 23
    })
    expect(source.daemonSessionOwnership?.projectTransferLineage).toEqual([])
    expect(target.daemonSessionOwnership?.projectTransferLineage).toEqual([])

    const snapshot = await loadRawDaemonOwnershipSnapshot(testState.dir)
    expect(snapshot).toMatchObject({ status: 'complete' })
    if (snapshot.status === 'complete') {
      expect(snapshot.claims.exact).toEqual(
        expect.arrayContaining([
          { sessionId: 'shared-session', protocolVersion: 22 },
          { sessionId: 'shared-session', protocolVersion: 23 },
          { sessionId: 'source-stays', protocolVersion: 24 },
          { sessionId: 'target-stays', protocolVersion: 22 }
        ])
      )
    }
  })

  it('copies no physical ownership and preserves both profiles existing claims', () => {
    writeRawState(
      'personal',
      persistedState({
        repos: [repo('repo-1', '/workspace/moved')],
        ownership: ownership([
          claim({ sessionId: 'source-session', protocolVersion: 22, workspaceKey: 'repo-1' })
        ])
      })
    )
    writeRawState(
      'work',
      persistedState({
        repos: [repo('repo-target-other', '/workspace/target')],
        ownership: ownership([
          claim({
            sessionId: 'target-session',
            protocolVersion: 23,
            workspaceKey: 'repo-target-other'
          })
        ])
      })
    )

    expect(transferOrcaProfileProject(moveArgs('copy'), testState.dir)).toMatchObject({
      status: 'transferred',
      mode: 'copy'
    })
    expect(readState('personal').daemonSessionOwnership?.claims).toEqual([
      expect.objectContaining({ sessionId: 'source-session' })
    ])
    expect(readState('work').daemonSessionOwnership?.claims).toEqual([
      expect.objectContaining({ sessionId: 'target-session' })
    ])
  })

  it('moves local-fallback and SSH binding provenance with project sessions', async () => {
    const remoteId = toAppSshPtyId('ssh-1', 'remote-pty')
    const sourceOwnership = ownership([])
    sourceOwnership.bindingProvenanceByPtyId = {
      'fallback-pty': { kind: 'local-fallback' },
      [remoteId]: { kind: 'remote', providerId: 'ssh-1' }
    }
    const workspaceSession = getDefaultPersistedState('/Users/tester').workspaceSession
    workspaceSession.tabsByWorktree = {
      'repo-1::/workspace/moved': [
        {
          id: 'fallback-tab',
          ptyId: 'fallback-pty',
          worktreeId: 'repo-1::/workspace/moved',
          title: 'Fallback',
          customTitle: null,
          color: null,
          sortOrder: 0,
          createdAt: 1
        },
        {
          id: 'remote-tab',
          ptyId: remoteId,
          worktreeId: 'repo-1::/workspace/moved',
          title: 'Remote',
          customTitle: null,
          color: null,
          sortOrder: 1,
          createdAt: 1
        }
      ]
    }
    writeRawState(
      'personal',
      persistedState({
        repos: [repo('repo-1', '/workspace/moved')],
        ownership: sourceOwnership,
        workspaceSession
      })
    )
    writeRawState('work', persistedState({ repos: [] }))

    expect(transferOrcaProfileProject(moveArgs(), testState.dir)).toMatchObject({
      status: 'transferred'
    })

    const target = readState('work')
    expect(target.daemonSessionOwnership?.bindingProvenanceByPtyId).toMatchObject({
      'fallback-pty': { kind: 'local-fallback' },
      [remoteId]: { kind: 'remote', providerId: 'ssh-1' }
    })
    await expect(loadRawDaemonOwnershipSnapshot(testState.dir)).resolves.toMatchObject({
      status: 'complete'
    })
  })

  it('conservatively protects local bindings moved from a legacy ownership profile', async () => {
    const source = persistedState({ repos: [repo('repo-1', '/workspace/moved')] })
    source.daemonSessionOwnership = undefined
    source.workspaceSession.tabsByWorktree = {
      'repo-1::/workspace/moved': [
        {
          id: 'legacy-tab',
          ptyId: 'legacy-local-pty',
          worktreeId: 'repo-1::/workspace/moved',
          title: 'Legacy',
          customTitle: null,
          color: null,
          sortOrder: 0,
          createdAt: 1
        }
      ]
    }
    writeRawState('personal', source)
    writeRawState('work', persistedState({ repos: [] }))

    expect(transferOrcaProfileProject(moveArgs(), testState.dir)).toMatchObject({
      status: 'transferred'
    })

    expect(readState('work').daemonSessionOwnership).toMatchObject({
      legacyProtectedSessionIds: ['legacy-local-pty'],
      bindingProvenanceByPtyId: {
        'legacy-local-pty': { kind: 'local-fallback' }
      }
    })
    await expect(loadRawDaemonOwnershipSnapshot(testState.dir)).resolves.toMatchObject({
      status: 'complete'
    })
  })

  it('does not classify a bare SSH-host binding as a local legacy session', async () => {
    const source = persistedState({ repos: [repo('repo-1', '/workspace/moved')] })
    source.daemonSessionOwnership = undefined
    const sshSession = structuredClone(source.workspaceSession)
    sshSession.tabsByWorktree = {
      'repo-1::/workspace/moved': [
        {
          id: 'ssh-tab',
          ptyId: 'bare-remote-pty',
          worktreeId: 'repo-1::/workspace/moved',
          title: 'SSH',
          customTitle: null,
          color: null,
          sortOrder: 0,
          createdAt: 1
        }
      ]
    }
    source.workspaceSessionsByHostId = { [toSshExecutionHostId('ssh-1')]: sshSession }
    writeRawState('personal', source)
    writeRawState('work', persistedState({ repos: [] }))

    expect(transferOrcaProfileProject(moveArgs(), testState.dir)).toMatchObject({
      status: 'transferred'
    })

    const targetOwnership = readState('work').daemonSessionOwnership
    expect(targetOwnership?.legacyProtectedSessionIds).not.toContain('bare-remote-pty')
    expect(targetOwnership?.bindingProvenanceByPtyId).not.toHaveProperty('bare-remote-pty')
    await expect(loadRawDaemonOwnershipSnapshot(testState.dir)).resolves.toMatchObject({
      status: 'complete'
    })
  })

  it('keeps the ownership snapshot complete at every legacy move crash boundary', async () => {
    const leafId = '11111111-1111-4111-8111-111111111111'
    const paneKey = `legacy-tab:${leafId}`
    const source = persistedState({ repos: [repo('repo-1', '/workspace/moved')] })
    source.daemonSessionOwnership = undefined
    source.workspaceSession.tabsByWorktree = {
      'repo-1::/workspace/moved': [
        {
          id: 'legacy-tab',
          ptyId: 'legacy-local-pty',
          worktreeId: 'repo-1::/workspace/moved',
          title: 'Legacy',
          customTitle: null,
          color: null,
          sortOrder: 0,
          createdAt: 1
        }
      ]
    }
    source.workspaceSession.terminalLayoutsByTabId = {
      'legacy-tab': {
        root: { type: 'leaf', leafId },
        activeLeafId: leafId,
        expandedLeafId: null,
        ptyIdsByLeafId: { [leafId]: 'legacy-local-pty' }
      }
    }
    source.workspaceSession.sleepingAgentSessionsByPaneKey = {
      [paneKey]: {
        paneKey,
        tabId: 'legacy-tab',
        worktreeId: 'repo-1::/workspace/moved',
        agent: 'claude',
        providerSession: { key: 'session_id', id: 'legacy-provider-session' },
        prompt: 'continue',
        state: 'waiting',
        capturedAt: 1,
        updatedAt: 1
      }
    }
    writeRawState('personal', source)
    writeRawState('work', persistedState({ repos: [] }))

    testState.failWriteAt = 2
    expect(() => transferOrcaProfileProject(moveArgs(), testState.dir)).toThrow(
      'injected-transfer-write-2'
    )
    await expect(loadRawDaemonOwnershipSnapshot(testState.dir)).resolves.toMatchObject({
      status: 'complete'
    })

    testState.writeCount = 0
    testState.failWriteAt = 3
    expect(() => transferOrcaProfileProject(moveArgs(), testState.dir)).toThrow(
      'injected-transfer-write-3'
    )
    await expect(loadRawDaemonOwnershipSnapshot(testState.dir)).resolves.toMatchObject({
      status: 'complete'
    })

    testState.writeCount = 0
    testState.failWriteAt = 0
    expect(transferOrcaProfileProject(moveArgs(), testState.dir)).toMatchObject({
      status: 'transferred'
    })
    await expect(loadRawDaemonOwnershipSnapshot(testState.dir)).resolves.toMatchObject({
      status: 'complete'
    })
  })

  it('reuses one pending lineage across crashes after source-pending and target writes', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000)
    writeRawState(
      'personal',
      persistedState({
        repos: [repo('repo-1', '/workspace/moved')],
        ownership: ownership([
          claim({ sessionId: 'moved-session', protocolVersion: 22, workspaceKey: 'repo-1' })
        ])
      })
    )
    writeRawState('work', persistedState({ repos: [] }))

    testState.failWriteAt = 2
    expect(() => transferOrcaProfileProject(moveArgs(), testState.dir)).toThrow(
      'injected-transfer-write-2'
    )
    const firstPending = readState('personal').daemonSessionOwnership?.projectTransferLineage ?? []
    expect(firstPending).toHaveLength(1)
    expect(firstPending[0]).toMatchObject({ role: 'source-pending', targetRepoId: 'repo-1' })

    testState.writeCount = 0
    testState.failWriteAt = 3
    expect(() => transferOrcaProfileProject(moveArgs(), testState.dir)).toThrow(
      'injected-transfer-write-3'
    )
    expect(readState('personal').daemonSessionOwnership?.projectTransferLineage).toEqual(
      firstPending
    )
    expect(readState('work').daemonSessionOwnership?.projectTransferLineage).toEqual([
      expect.objectContaining({
        operationId: firstPending[0]?.operationId,
        role: 'target-lineage',
        repoId: 'repo-1',
        targetRepoId: 'repo-1'
      })
    ])
    const targetGenerationBeforeCleanup = readState('work').daemonOwnershipCommit?.generation
    testState.writeCount = 0
    testState.failWriteAt = 0
    expect(transferOrcaProfileProject(moveArgs(), testState.dir)).toMatchObject({
      status: 'transferred',
      targetRepoId: 'repo-1'
    })
    expect(readState('personal').repos).toEqual([])
    expect(readState('work').repos.filter(({ id }) => id === 'repo-1')).toHaveLength(1)
    expect(readState('work').daemonSessionOwnership?.projectTransferLineage).toEqual([])
    expect(readState('work').daemonOwnershipCommit?.generation).toBeGreaterThan(
      targetGenerationBeforeCleanup ?? 0
    )
  })

  it('treats source deletion as committed and retries final target receipt cleanup', async () => {
    writeRawState(
      'personal',
      persistedState({
        repos: [repo('repo-1', '/workspace/moved')],
        ownership: ownership([
          claim({ sessionId: 'moved-session', protocolVersion: 23, workspaceKey: 'repo-1' })
        ])
      })
    )
    writeRawState('work', persistedState({ repos: [] }))
    testState.failWriteAt = 4

    expect(transferOrcaProfileProject(moveArgs(), testState.dir)).toMatchObject({
      status: 'transferred',
      targetRepoId: 'repo-1'
    })
    expect(readState('personal').repos).toEqual([])
    expect(readState('work').daemonSessionOwnership?.projectTransferLineage).toEqual([
      expect.objectContaining({ role: 'target-lineage' })
    ])

    testState.failWriteAt = 0
    testState.writeCount = 0
    await recoverCompletedProjectTransfers(testState.dir)

    expect(readState('work').daemonSessionOwnership?.projectTransferLineage).toEqual([])
    expect(readState('work').daemonSessionOwnership?.claims).toEqual([
      expect.objectContaining({ sessionId: 'moved-session', workspaceKey: 'repo-1' })
    ])
  })
})

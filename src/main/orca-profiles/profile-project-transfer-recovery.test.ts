import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultPersistedState } from '../../shared/constants'
import { createEmptyDaemonSessionOwnershipState } from '../../shared/daemon-session-ownership'
import {
  ORCA_PROFILE_INDEX_SCHEMA_VERSION,
  type OrcaProfileIndex,
  type OrcaProfileSummary
} from '../../shared/orca-profiles'
import type { PersistedState, Repo } from '../../shared/types'
import { withDaemonOwnershipCommit } from '../daemon/daemon-ownership-commit'
import { recoverCompletedProjectTransfers } from './profile-project-transfer-recovery'

const testState = { dir: '' }

vi.mock('electron', () => ({ app: { getPath: () => testState.dir } }))

function profile(id: string): OrcaProfileSummary {
  return {
    id,
    name: id,
    avatar: { kind: 'initials', initials: 'P', color: 'neutral' },
    kind: 'local',
    initialized: true,
    createdAt: 1,
    updatedAt: 1,
    lastOpenedAt: 1
  }
}

function writeIndex(profiles: OrcaProfileSummary[], activeProfileId = profiles[0].id): void {
  const index: OrcaProfileIndex = {
    schemaVersion: ORCA_PROFILE_INDEX_SCHEMA_VERSION,
    activeProfileId,
    profiles
  }
  writeFileSync(join(testState.dir, 'orca-profile-index.json'), JSON.stringify(index), 'utf8')
}

function statePath(profileId: string): string {
  return join(testState.dir, 'profiles', profileId, 'orca-data.json')
}

function writeRaw(profileId: string, contents: string): void {
  const path = statePath(profileId)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, contents, 'utf8')
}

function writeCommitted(profileId: string, state: PersistedState): void {
  writeRaw(profileId, JSON.stringify(withDaemonOwnershipCommit(state, 1), null, 2))
}

function repo(): Repo {
  return {
    id: 'repo-1',
    path: '/workspace/orca',
    displayName: 'Orca',
    badgeColor: '#33aa99',
    addedAt: 1,
    kind: 'git',
    connectionId: null
  }
}

function recoverableStates(): { source: PersistedState; target: PersistedState } {
  const source = getDefaultPersistedState('/Users/tester')
  const ownership = createEmptyDaemonSessionOwnershipState()
  ownership.projectTransferLineage = [
    {
      operationId: 'operation-a',
      role: 'target-lineage',
      sourceProfileId: 'source',
      targetProfileId: 'target',
      repoId: 'repo-1',
      targetRepoId: 'repo-1',
      createdAt: 1
    }
  ]
  return {
    source,
    target: {
      ...getDefaultPersistedState('/Users/tester'),
      repos: [repo()],
      daemonSessionOwnership: ownership
    }
  }
}

describe('completed project transfer recovery', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'orca-transfer-recovery-'))
  })

  afterEach(() => {
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it('leaves many inactive legacy profiles without receipts byte-identical and uncommitted', async () => {
    const profiles = Array.from({ length: 100 }, (_, index) => profile(`profile-${index}`))
    writeIndex(profiles)
    const legacy = JSON.stringify({ settings: {}, daemonSessionOwnership: { claims: [] } })
    const mtimes = new Map<string, number>()
    for (const candidate of profiles) {
      writeRaw(candidate.id, legacy)
      mtimes.set(candidate.id, statSync(statePath(candidate.id)).mtimeMs)
    }

    await recoverCompletedProjectTransfers(testState.dir)

    for (const candidate of profiles) {
      const contents = readFileSync(statePath(candidate.id), 'utf8')
      expect(contents).toBe(legacy)
      expect(contents).not.toContain('daemonOwnershipCommit')
      expect(statSync(statePath(candidate.id)).mtimeMs).toBe(mtimes.get(candidate.id))
    }
  })

  it('recovers one valid receipt without touching unrelated inactive state', async () => {
    writeIndex([profile('source'), profile('target'), profile('unrelated')])
    const { source, target } = recoverableStates()
    writeCommitted('source', source)
    writeCommitted('target', target)
    const unrelated = JSON.stringify({ settings: { theme: 'legacy' } })
    writeRaw('unrelated', unrelated)

    await recoverCompletedProjectTransfers(testState.dir)

    const recovered = JSON.parse(readFileSync(statePath('target'), 'utf8')) as PersistedState
    expect(recovered.daemonSessionOwnership?.projectTransferLineage).toEqual([])
    expect(readFileSync(statePath('unrelated'), 'utf8')).toBe(unrelated)
  })

  it('does not overwrite an active Store-owned target receipt', async () => {
    writeIndex([profile('source'), profile('target')], 'target')
    const { source, target } = recoverableStates()
    writeCommitted('source', source)
    writeCommitted('target', target)
    const before = readFileSync(statePath('target'), 'utf8')

    await recoverCompletedProjectTransfers(testState.dir)

    expect(readFileSync(statePath('target'), 'utf8')).toBe(before)
  })

  it('does not overwrite an inactive target changed after the bounded scan', async () => {
    writeIndex([profile('source'), profile('target')])
    const { source, target } = recoverableStates()
    writeCommitted('source', source)
    writeCommitted('target', target)
    const changedTarget = {
      ...target,
      ui: { ...target.ui, lastActiveRepoId: 'concurrent-change' }
    }
    let yields = 0
    const yieldControl = vi.fn(async () => {
      yields += 1
      if (yields === 5) {
        writeCommitted('target', changedTarget)
      }
    })

    await recoverCompletedProjectTransfers(testState.dir, { yieldControl })

    expect(readFileSync(statePath('target'), 'utf8')).toBe(
      JSON.stringify(withDaemonOwnershipCommit(changedTarget, 1), null, 2)
    )
  })

  it('does not backfill an uncommitted file that resembles a target receipt', async () => {
    writeIndex([profile('target')])
    const uncommitted = JSON.stringify({
      daemonSessionOwnership: {
        projectTransferLineage: [
          { role: 'target-lineage', sourceProfileId: 'source', targetProfileId: 'target' }
        ]
      }
    })
    writeRaw('target', uncommitted)

    await recoverCompletedProjectTransfers(testState.dir)

    expect(readFileSync(statePath('target'), 'utf8')).toBe(uncommitted)
  })

  it('yields between every discovery and recovery profile turn', async () => {
    writeIndex([profile('one'), profile('two'), profile('three')])
    const yieldControl = vi.fn(async () => {})

    await recoverCompletedProjectTransfers(testState.dir, { yieldControl })

    expect(yieldControl).toHaveBeenCalledTimes(7)
  })

  it('performs zero recovery writes when the profile limit is exceeded', async () => {
    const profiles = [profile('source'), profile('target'), profile('extra')]
    writeIndex(profiles)
    const { source, target } = recoverableStates()
    writeCommitted('source', source)
    writeCommitted('target', target)
    const before = readFileSync(statePath('target'), 'utf8')

    await recoverCompletedProjectTransfers(testState.dir, { maxProfiles: 2 })

    expect(readFileSync(statePath('target'), 'utf8')).toBe(before)
  })

  it('performs zero recovery writes when the profile index byte limit is exceeded', async () => {
    writeIndex([profile('source'), profile('target')])
    const { source, target } = recoverableStates()
    writeCommitted('source', source)
    writeCommitted('target', target)
    const before = readFileSync(statePath('target'), 'utf8')

    await recoverCompletedProjectTransfers(testState.dir, { maxIndexBytes: 8 })

    expect(readFileSync(statePath('target'), 'utf8')).toBe(before)
  })

  it.each([
    ['per-file', { maxFileBytes: 8, maxCaptureBytes: 1_000_000 }],
    ['aggregate', { maxFileBytes: 1_000_000, maxCaptureBytes: 16 }]
  ])('performs zero recovery writes when the %s byte limit is exceeded', async (_, limits) => {
    writeIndex([profile('source'), profile('target')])
    const { source, target } = recoverableStates()
    writeCommitted('source', source)
    writeCommitted('target', target)
    const before = readFileSync(statePath('target'), 'utf8')

    await recoverCompletedProjectTransfers(testState.dir, limits)

    expect(readFileSync(statePath('target'), 'utf8')).toBe(before)
  })
})

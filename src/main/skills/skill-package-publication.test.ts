import { cp, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ManagedSkillDestination, SkillReleasedSnapshot } from '../../shared/skill-management'
import { observeSkillPackage, persistedObservedFiles } from './skill-package-identity'
import type { SkillOwnedTempRuntime } from './skill-owned-temp-publication'
import { publishSkillPackageInPlace } from './skill-package-publication'
import { skillPhysicalIdentity } from './skill-installation-topology'
import type { SkillTransactionMarker } from './skill-transaction-marker'
import { assertTransactionOwnedState } from './skill-transaction-owned-state'
import type { SkillPublicationState } from './skill-transaction-publication-state'
import { retrySkillRename } from './skill-transaction-rename'

const roots: string[] = []

async function createPackage(root: string, values: Record<string, string>): Promise<void> {
  await mkdir(root, { recursive: true })
  for (const [path, contents] of Object.entries(values)) {
    await writeFile(join(root, path), contents)
  }
}

async function snapshot(root: string, releaseRevision: number): Promise<SkillReleasedSnapshot> {
  const observed = await observeSkillPackage(root)
  return {
    releaseRevision,
    packageDigest: observed.observedDigest,
    gitTreeSha: '',
    files: persistedObservedFiles(observed)
  }
}

async function swapFixture() {
  const root = await mkdtemp(join(tmpdir(), 'orca-swap-authority-'))
  roots.push(root)
  const live = join(root, 'skills', 'orca-cli')
  const transactionRoot = join(root, 'transaction')
  const stageRoot = join(transactionRoot, 'stage')
  const backupRoot = join(transactionRoot, 'backup')
  await createPackage(live, { 'SKILL.md': 'old entry', 'asset.txt': 'old asset' })
  await createPackage(stageRoot, { 'SKILL.md': 'new entry', 'asset.txt': 'new asset' })
  await cp(live, backupRoot, { recursive: true })
  const prior = await snapshot(live, 1)
  const current = await snapshot(stageRoot, 2)
  const record = {
    resolvedPath: live,
    physicalIdentity: skillPhysicalIdentity(live, await stat(live))
  } as ManagedSkillDestination
  let marker: SkillTransactionMarker = {
    schemaVersion: 1,
    transactionId: 'test',
    createdAt: 1,
    destinationId: '000000000000000000000000',
    destinationPath: live,
    physicalIdentity: record.physicalIdentity,
    hostId: 'local',
    skillName: 'orca-cli',
    phase: 'publishing',
    stagePhysicalIdentity: skillPhysicalIdentity(stageRoot, await stat(stageRoot)),
    backupPhysicalIdentity: skillPhysicalIdentity(backupRoot, await stat(backupRoot)),
    stageBuild: {
      state: 'ready',
      physicalIdentity: skillPhysicalIdentity(stageRoot, await stat(stageRoot)),
      operationIndex: current.files.length,
      pendingPath: null,
      activeFile: null
    },
    backupBuild: {
      state: 'ready',
      physicalIdentity: skillPhysicalIdentity(backupRoot, await stat(backupRoot)),
      operationIndex: prior.files.length,
      pendingPath: null,
      activeFile: null
    },
    publication: null,
    priorSnapshot: prior,
    currentSnapshot: current
  }
  const history: SkillPublicationState[] = []
  const journal = async (publication: SkillPublicationState): Promise<void> => {
    marker = { ...marker, publication }
    history.push(publication)
  }
  const assertBoundary = async (
    publication: SkillPublicationState,
    expectedLiveState?: Awaited<ReturnType<typeof assertTransactionOwnedState>>
  ): Promise<void> => {
    const liveState = await assertTransactionOwnedState({
      transactionRoot,
      marker: { ...marker, publication },
      assertParent: async () => undefined,
      allowAppliedOperation: false
    })
    if (expectedLiveState && liveState !== expectedLiveState) {
      throw new Error('skill-transaction-recovery-required')
    }
  }
  return {
    live,
    transactionRoot,
    stageRoot,
    oldLiveRoot: join(transactionRoot, 'old-live'),
    record,
    prior,
    current: { ...current, name: 'orca-cli', sourcePath: '', appVersion: '1.0.0' },
    callbacks: { journal, assertBoundary },
    history,
    marker: () => marker
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('skill package publication boundaries', () => {
  it('rejects a temp replacement made while the creating journal is awaited', async () => {
    const fixture = await swapFixture()
    let replaced = false
    const journal = async (publication: SkillPublicationState): Promise<void> => {
      await fixture.callbacks.journal(publication)
      if (
        !replaced &&
        publication.kind === 'in-place' &&
        publication.temporary?.state === 'creating'
      ) {
        replaced = true
        const temporaryPath = join(fixture.live, ...publication.temporary.path.split('/'))
        await rm(temporaryPath)
        await cp(join(fixture.stageRoot, publication.temporary.expectedFile.path), temporaryPath)
      }
    }

    await expect(
      publishSkillPackageInPlace({
        record: fixture.record,
        prior: fixture.prior,
        current: fixture.current,
        stageRoot: fixture.stageRoot,
        callbacks: { ...fixture.callbacks, journal }
      })
    ).rejects.toThrow('skill-transaction-recovery-required')
    expect(replaced).toBe(true)
    expect(await readFile(join(fixture.live, 'asset.txt'), 'utf8')).toBe('old asset')
  })

  it.each([
    {
      boundary: 'source read',
      runtime: (): SkillOwnedTempRuntime => ({
        readSource: async (source) => {
          const bytes = await readFile(source)
          await writeFile(source, 'independent source edit')
          return bytes
        }
      })
    },
    {
      boundary: 'handle write',
      runtime: (fixture: Awaited<ReturnType<typeof swapFixture>>): SkillOwnedTempRuntime => ({
        writeBytes: async (handle, bytes) => {
          await handle.writeFile(bytes)
          await writeFile(join(fixture.live, 'SKILL.md'), 'independent live edit')
        }
      })
    },
    {
      boundary: 'chmod',
      runtime: (fixture: Awaited<ReturnType<typeof swapFixture>>): SkillOwnedTempRuntime => ({
        chmodTemp: async (handle, mode) => {
          await handle.chmod(mode)
          await writeFile(join(fixture.live, 'SKILL.md'), 'independent live edit')
        }
      })
    },
    {
      boundary: 'sync',
      runtime: (fixture: Awaited<ReturnType<typeof swapFixture>>): SkillOwnedTempRuntime => ({
        syncTemp: async (handle) => {
          await handle.sync()
          await writeFile(join(fixture.live, 'SKILL.md'), 'independent live edit')
        }
      })
    }
  ])('rechecks authority after the $boundary await', async ({ runtime }) => {
    const fixture = await swapFixture()
    await expect(
      publishSkillPackageInPlace({
        record: fixture.record,
        prior: fixture.prior,
        current: fixture.current,
        stageRoot: fixture.stageRoot,
        callbacks: fixture.callbacks,
        ownedTempRuntime: runtime(fixture)
      })
    ).rejects.toThrow('skill-transaction-recovery-required')
  })

  it('retains creating evidence when handle write mutates then throws', async () => {
    const fixture = await swapFixture()
    await expect(
      publishSkillPackageInPlace({
        record: fixture.record,
        prior: fixture.prior,
        current: fixture.current,
        stageRoot: fixture.stageRoot,
        callbacks: fixture.callbacks,
        ownedTempRuntime: {
          writeBytes: async (handle, bytes) => {
            await handle.write(bytes.subarray(0, 1))
            throw new Error('injected-write-failure')
          }
        }
      })
    ).rejects.toThrow('injected-write-failure')
    expect(fixture.history.at(-1)).toMatchObject({
      kind: 'in-place',
      temporary: { state: 'creating' }
    })
    expect(await readFile(join(fixture.live, 'asset.txt'), 'utf8')).toBe('old asset')
  })

  it('journals each forward temp inode through creating, written, ready, and applied', async () => {
    const fixture = await swapFixture()
    await publishSkillPackageInPlace({
      record: fixture.record,
      prior: fixture.prior,
      current: fixture.current,
      stageRoot: fixture.stageRoot,
      callbacks: fixture.callbacks
    })

    const states = fixture.history.flatMap((publication) =>
      publication.kind === 'in-place' && publication.temporary ? [publication.temporary.state] : []
    )
    expect(states).toEqual([
      'creating',
      'written',
      'ready',
      'applied',
      'creating',
      'written',
      'ready',
      'applied'
    ])
  })

  it('rejects an exact wrong-inode target replacement after temp rename', async () => {
    const fixture = await swapFixture()
    let replaced = false
    const journal = async (publication: SkillPublicationState): Promise<void> => {
      await fixture.callbacks.journal(publication)
      if (
        !replaced &&
        publication.kind === 'in-place' &&
        publication.temporary?.state === 'applied'
      ) {
        replaced = true
        const target = join(fixture.live, publication.temporary.expectedFile.path)
        // Keep the original inode alive so filesystems cannot recycle it for
        // the replacement and make this authority fixture nondeterministic.
        await rename(target, `${target}.original`)
        await cp(join(fixture.stageRoot, publication.temporary.expectedFile.path), target)
      }
    }

    await expect(
      publishSkillPackageInPlace({
        record: fixture.record,
        prior: fixture.prior,
        current: fixture.current,
        stageRoot: fixture.stageRoot,
        callbacks: { ...fixture.callbacks, journal }
      })
    ).rejects.toThrow('skill-transaction-recovery-required')
    expect(replaced).toBe(true)
  })

  it('does not overwrite an in-place edit made between ordered file operations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-publication-boundary-'))
    roots.push(root)
    const live = join(root, 'skills', 'orca-cli')
    const transactionRoot = join(root, 'transaction')
    const stageRoot = join(transactionRoot, 'stage')
    const backupRoot = join(transactionRoot, 'backup')
    await createPackage(live, { 'SKILL.md': 'old entry', 'asset.txt': 'old asset' })
    await createPackage(stageRoot, { 'SKILL.md': 'new entry', 'asset.txt': 'new asset' })
    await cp(live, backupRoot, { recursive: true })
    const prior = await snapshot(live, 1)
    const current = await snapshot(stageRoot, 2)
    const record = {
      resolvedPath: live,
      physicalIdentity: skillPhysicalIdentity(live, await stat(live))
    } as ManagedSkillDestination
    let marker: SkillTransactionMarker = {
      schemaVersion: 1,
      transactionId: 'test',
      createdAt: 1,
      destinationId: '000000000000000000000000',
      destinationPath: live,
      physicalIdentity: record.physicalIdentity,
      hostId: 'local',
      skillName: 'orca-cli',
      phase: 'publishing',
      stagePhysicalIdentity: skillPhysicalIdentity(stageRoot, await stat(stageRoot)),
      backupPhysicalIdentity: skillPhysicalIdentity(backupRoot, await stat(backupRoot)),
      stageBuild: {
        state: 'ready',
        physicalIdentity: skillPhysicalIdentity(stageRoot, await stat(stageRoot)),
        operationIndex: current.files.length,
        pendingPath: null,
        activeFile: null
      },
      backupBuild: {
        state: 'ready',
        physicalIdentity: skillPhysicalIdentity(backupRoot, await stat(backupRoot)),
        operationIndex: prior.files.length,
        pendingPath: null,
        activeFile: null
      },
      publication: null,
      priorSnapshot: prior,
      currentSnapshot: current
    }
    const journal = async (publication: SkillPublicationState): Promise<void> => {
      marker = { ...marker, publication }
    }
    let edited = false
    const assertBoundary = async (publication: SkillPublicationState): Promise<void> => {
      if (
        !edited &&
        publication.kind === 'in-place' &&
        publication.operationState === 'applying' &&
        publication.operationIndex === 1
      ) {
        edited = true
        await writeFile(join(live, 'SKILL.md'), 'independent edit')
      }
      await assertTransactionOwnedState({
        transactionRoot,
        marker: { ...marker, publication },
        assertParent: async () => undefined,
        allowAppliedOperation: false
      })
    }

    await expect(
      publishSkillPackageInPlace({
        record,
        current: { ...current, name: 'orca-cli', sourcePath: '', appVersion: '1.0.0' },
        prior,
        stageRoot,
        callbacks: { journal, assertBoundary }
      })
    ).rejects.toThrow('skill-transaction-recovery-required')

    expect(await readFile(join(live, 'asset.txt'), 'utf8')).toBe('new asset')
    expect(await readFile(join(live, 'SKILL.md'), 'utf8')).toBe('independent edit')
    expect(marker.publication).toMatchObject({ operationIndex: 1, operationState: 'applying' })
  })

  it('revalidates after a sharing-violation retry window', async () => {
    let renameAttempts = 0
    let boundaryChecks = 0
    let changedDuringWait = false
    const renameEntry = async (): Promise<void> => {
      renameAttempts += 1
      if (renameAttempts === 1) {
        throw Object.assign(new Error('busy'), { code: 'EPERM' })
      }
    }
    await expect(
      retrySkillRename(
        'source',
        'destination',
        async () => {
          boundaryChecks += 1
          if (changedDuringWait) {
            throw new Error('skill-content-changed')
          }
        },
        renameEntry,
        async () => {
          changedDuringWait = true
        }
      )
    ).rejects.toThrow('skill-content-changed')
    expect(renameAttempts).toBe(1)
    expect(boundaryChecks).toBe(2)
  })

  it.each(['replaced', 'missing'] as const)(
    'does not rename a %s journaled temp file',
    async (mutation) => {
      const fixture = await swapFixture()
      let activeMarker = fixture.marker()
      let mutated = false
      const journal = async (publication: SkillPublicationState): Promise<void> => {
        activeMarker = { ...activeMarker, publication }
      }
      const assertBoundary = async (publication: SkillPublicationState): Promise<void> => {
        if (!mutated && publication.kind === 'in-place' && publication.temporary) {
          mutated = true
          const temporaryPath = join(fixture.live, ...publication.temporary.path.split('/'))
          await rm(temporaryPath)
          if (mutation === 'replaced') {
            await cp(
              join(fixture.stageRoot, publication.temporary.expectedFile.path),
              temporaryPath
            )
          }
        }
        await assertTransactionOwnedState({
          transactionRoot: fixture.transactionRoot,
          marker: { ...activeMarker, publication },
          assertParent: async () => undefined,
          allowAppliedOperation: false
        })
      }
      await expect(
        publishSkillPackageInPlace({
          record: fixture.record,
          prior: fixture.prior,
          current: fixture.current,
          stageRoot: fixture.stageRoot,
          callbacks: { journal, assertBoundary }
        })
      ).rejects.toThrow('skill-transaction-recovery-required')
      expect(await readFile(join(fixture.live, 'asset.txt'), 'utf8')).toBe('old asset')
      if (mutation === 'replaced') {
        expect(
          await readFile(
            join(
              fixture.live,
              ...(activeMarker.publication?.kind === 'in-place' &&
              activeMarker.publication.temporary
                ? activeMarker.publication.temporary.path.split('/')
                : [])
            ),
            'utf8'
          )
        ).toBe('new asset')
      }
    }
  )
})

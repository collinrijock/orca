import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ManagedSkillDestination, SkillReleasedSnapshot } from '../../shared/skill-management'
import { observeSkillPackage, persistedObservedFiles } from './skill-package-identity'
import { skillDestinationId, skillPhysicalIdentity } from './skill-installation-topology'
import {
  acquireSkillDestinationLock,
  recoverMarkedSkillTransactions
} from './skill-transaction-recovery'
import { sweepOrphanedSkillTransactions } from './skill-orphan-transaction-sweep'
import {
  parseSkillTransactionMarker,
  type SkillTransactionMarker
} from './skill-transaction-marker'
import { writeSkillTransactionMarker } from './skill-transaction-marker-write'
import { emptySkillManagementLedger } from './skill-management-ledger'

const temporaryRoots: string[] = []

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'orca-skill-recovery-'))
  temporaryRoots.push(root)
  const live = join(root, 'skills', 'orca-cli')
  await mkdir(join(root, 'skills'), { recursive: true })
  await cp(resolve('skills/orca-cli'), live, { recursive: true })
  const resolvedLive = await realpath(live)
  const observed = await observeSkillPackage(resolvedLive)
  const files = persistedObservedFiles(observed)
  const snapshot: SkillReleasedSnapshot = {
    releaseRevision: 1,
    packageDigest: observed.observedDigest,
    gitTreeSha: '',
    files
  }
  const record = {
    id: skillDestinationId('local', live, 'orca-cli'),
    hostId: 'local',
    skillName: 'orca-cli',
    resolvedPath: resolvedLive,
    unresolvedPath: live,
    physicalIdentity: skillPhysicalIdentity(resolvedLive, await stat(resolvedLive)),
    entryType: 'directory',
    topology: 'canonical-copy',
    installedReleaseRevision: snapshot.releaseRevision,
    installedFiles: files,
    installedPackageDigest: observed.observedDigest
  } as unknown as ManagedSkillDestination
  return { root, live, snapshot, record }
}

function marker(
  record: ManagedSkillDestination,
  snapshot: SkillReleasedSnapshot,
  phase: SkillTransactionMarker['phase']
): SkillTransactionMarker {
  return {
    schemaVersion: 1,
    transactionId: 'test-transaction',
    createdAt: 1,
    destinationId: record.id,
    destinationPath: record.resolvedPath,
    physicalIdentity: record.physicalIdentity,
    hostId: record.hostId,
    skillName: record.skillName,
    phase,
    stagePhysicalIdentity: null,
    backupPhysicalIdentity: null,
    stageBuild: null,
    backupBuild: null,
    publication: null,
    priorSnapshot: snapshot,
    currentSnapshot: { ...snapshot, releaseRevision: snapshot.releaseRevision + 1 }
  }
}

async function writePublishingMarker(args: {
  transaction: string
  record: ManagedSkillDestination
  prior: SkillReleasedSnapshot
  current?: SkillReleasedSnapshot
  stageSource: string
  operationIndex?: number
}): Promise<void> {
  const stageRoot = join(args.transaction, 'stage')
  await cp(args.stageSource, stageRoot, { recursive: true })
  const stagePhysicalIdentity = skillPhysicalIdentity(stageRoot, await stat(stageRoot))
  const backupRoot = join(args.transaction, 'backup')
  const backupPhysicalIdentity = skillPhysicalIdentity(backupRoot, await stat(backupRoot))
  const currentSnapshot = args.current ?? {
    ...args.prior,
    releaseRevision: args.prior.releaseRevision + 1
  }
  await writeSkillTransactionMarker(args.transaction, {
    ...marker(args.record, args.prior, 'publishing'),
    currentSnapshot,
    stagePhysicalIdentity,
    backupPhysicalIdentity,
    stageBuild: {
      state: 'ready',
      physicalIdentity: stagePhysicalIdentity,
      operationIndex: currentSnapshot.files.length,
      pendingPath: null,
      activeFile: null
    },
    backupBuild: {
      state: 'ready',
      physicalIdentity: backupPhysicalIdentity,
      operationIndex: args.prior.files.length,
      pendingPath: null,
      activeFile: null
    },
    publication: {
      kind: 'in-place',
      direction: 'forward',
      physicalIdentity: args.record.physicalIdentity,
      temporary: null,
      operationIndex: args.operationIndex ?? 0,
      operationState: 'ready'
    }
  })
}

async function writeSwapMarker(args: {
  transaction: string
  record: ManagedSkillDestination
  snapshot: SkillReleasedSnapshot
  stageSource: string
  step: Extract<SkillTransactionMarker['publication'], { kind: 'package-swap' }>['step']
}): Promise<void> {
  const stageRoot = join(args.transaction, 'stage')
  const backupRoot = join(args.transaction, 'backup')
  await cp(args.stageSource, stageRoot, { recursive: true })
  await cp(args.stageSource, backupRoot, { recursive: true })
  const stagePhysicalIdentity = skillPhysicalIdentity(stageRoot, await stat(stageRoot))
  const backupPhysicalIdentity = skillPhysicalIdentity(backupRoot, await stat(backupRoot))
  await writeSkillTransactionMarker(args.transaction, {
    ...marker(args.record, args.snapshot, 'publishing'),
    stagePhysicalIdentity,
    backupPhysicalIdentity,
    stageBuild: {
      state: 'ready',
      physicalIdentity: stagePhysicalIdentity,
      operationIndex: args.snapshot.files.length,
      pendingPath: null,
      activeFile: null
    },
    backupBuild: {
      state: 'ready',
      physicalIdentity: backupPhysicalIdentity,
      operationIndex: args.snapshot.files.length,
      pendingPath: null,
      activeFile: null
    },
    publication: { kind: 'package-swap', step: args.step }
  })
}

async function writeCreatingStageMarker(args: {
  transaction: string
  record: ManagedSkillDestination
  snapshot: SkillReleasedSnapshot
}): Promise<string> {
  const stageRoot = join(args.transaction, 'stage')
  const firstFile = args.snapshot.files[0]!
  const activePath = join(stageRoot, ...firstFile.path.split('/'))
  await mkdir(dirname(activePath), { recursive: true })
  await writeFile(activePath, 'partial')
  const stagePhysicalIdentity = skillPhysicalIdentity(stageRoot, await stat(stageRoot))
  await writeSkillTransactionMarker(args.transaction, {
    ...marker(args.record, args.snapshot, 'staging'),
    stagePhysicalIdentity,
    stageBuild: {
      state: 'creating',
      physicalIdentity: stagePhysicalIdentity,
      operationIndex: 0,
      pendingPath: null,
      activeFile: {
        path: firstFile.path,
        physicalIdentity: skillPhysicalIdentity(activePath, await stat(activePath)),
        contentState: 'created'
      }
    }
  })
  return stageRoot
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })))
})

describe('skill transaction recovery', () => {
  it('removes only marked staging transactions', async () => {
    const { root, record, snapshot } = await fixture()
    const reservedRoot = join(root, '.orca-skill-transactions')
    const marked = join(reservedRoot, 'marked')
    const unmarked = join(reservedRoot, 'user-data')
    await mkdir(marked, { recursive: true })
    await mkdir(unmarked, { recursive: true })
    await writeSkillTransactionMarker(marked, marker(record, snapshot, 'staging'))

    await recoverMarkedSkillTransactions({
      reservedRoot,
      record
    })

    await expect(readFile(join(marked, 'transaction.json'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
    await expect(readFile(join(unmarked, 'transaction.json'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
    expect(await import('node:fs/promises').then(({ stat }) => stat(unmarked))).toBeTruthy()
  })

  it('cleans only an identity-matched partial stage package', async () => {
    const { root, record, snapshot } = await fixture()
    const reservedRoot = join(root, '.orca-skill-transactions')
    const transaction = join(reservedRoot, 'partial-stage')
    await mkdir(transaction, { recursive: true })
    await writeCreatingStageMarker({ transaction, record, snapshot })

    await recoverMarkedSkillTransactions({ reservedRoot, record })

    await expect(lstat(transaction)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('retains a transaction when the recorded partial stage root was replaced', async () => {
    const { root, record, snapshot } = await fixture()
    const reservedRoot = join(root, '.orca-skill-transactions')
    const transaction = join(reservedRoot, 'replaced-stage')
    await mkdir(transaction, { recursive: true })
    const stageRoot = await writeCreatingStageMarker({ transaction, record, snapshot })
    await rm(stageRoot, { recursive: true })
    await mkdir(stageRoot)

    await expect(recoverMarkedSkillTransactions({ reservedRoot, record })).rejects.toThrow(
      'skill-transaction-recovery-required'
    )
    await expect(lstat(transaction)).resolves.toBeDefined()
  })

  it('retains rollback instead of overwriting an unknown same-inode edit', async () => {
    const { root, live, record, snapshot } = await fixture()
    const reservedRoot = join(root, '.orca-skill-transactions')
    const transaction = join(reservedRoot, 'interrupted')
    await cp(live, join(transaction, 'backup'), { recursive: true })
    await writePublishingMarker({
      transaction,
      record,
      prior: snapshot,
      stageSource: live
    })
    await writeFile(join(live, 'SKILL.md'), 'partial new package')

    await expect(recoverMarkedSkillTransactions({ reservedRoot, record })).rejects.toThrow(
      'skill-transaction-recovery-required'
    )

    expect(await readFile(join(live, 'SKILL.md'), 'utf8')).toBe('partial new package')
    expect(await readFile(join(transaction, 'transaction.json'), 'utf8')).toBeTruthy()
  })

  it('restores a genuine mixed old/new package owned by the transaction', async () => {
    const { root, live, record, snapshot } = await fixture()
    const reservedRoot = join(root, '.orca-skill-transactions')
    const transaction = join(reservedRoot, 'expected-partial')
    const currentRoot = join(root, 'current-package')
    await cp(live, join(transaction, 'backup'), { recursive: true })
    await cp(live, currentRoot, { recursive: true })
    await writeFile(join(currentRoot, 'SKILL.md'), 'expected current entry point')
    await writeFile(join(currentRoot, 'asset.txt'), 'expected new asset')
    const currentObserved = await observeSkillPackage(currentRoot)
    const currentSnapshot: SkillReleasedSnapshot = {
      releaseRevision: 2,
      packageDigest: currentObserved.observedDigest,
      gitTreeSha: '',
      files: persistedObservedFiles(currentObserved)
    }
    await writePublishingMarker({
      transaction,
      record,
      prior: snapshot,
      current: currentSnapshot,
      stageSource: currentRoot,
      operationIndex: 1
    })
    await writeFile(join(live, 'asset.txt'), 'expected new asset')

    await recoverMarkedSkillTransactions({ reservedRoot, record })

    expect(await observeSkillPackage(live)).toMatchObject({
      observedDigest: snapshot.packageDigest
    })
  })

  it.each(['creating', 'ready'] as const)(
    'removes an identity-owned %s publication temp before resuming recovery',
    async (temporaryState) => {
      const { root, live, record, snapshot } = await fixture()
      const reservedRoot = join(root, '.orca-skill-transactions')
      const transaction = join(reservedRoot, 'publication-temp')
      const currentRoot = join(root, 'temp-current')
      await cp(live, join(transaction, 'backup'), { recursive: true })
      await cp(live, currentRoot, { recursive: true })
      await writeFile(join(currentRoot, 'asset.txt'), 'new asset')
      const currentObserved = await observeSkillPackage(currentRoot)
      const currentSnapshot: SkillReleasedSnapshot = {
        releaseRevision: 2,
        packageDigest: currentObserved.observedDigest,
        gitTreeSha: '',
        files: persistedObservedFiles(currentObserved)
      }
      await writePublishingMarker({
        transaction,
        record,
        prior: snapshot,
        current: currentSnapshot,
        stageSource: currentRoot
      })
      const writtenMarker = parseSkillTransactionMarker(
        await readFile(join(transaction, 'transaction.json'), 'utf8')
      )
      expect(writtenMarker).not.toBeNull()
      const temporaryPath = 'asset.txt.orca-test.tmp'
      await writeFile(
        join(live, temporaryPath),
        temporaryState === 'creating' ? 'partial' : await readFile(join(currentRoot, 'asset.txt'))
      )
      await writeSkillTransactionMarker(transaction, {
        ...writtenMarker!,
        publication: {
          kind: 'in-place',
          direction: 'forward',
          physicalIdentity: record.physicalIdentity,
          temporary: {
            path: temporaryPath,
            physicalIdentity: skillPhysicalIdentity(
              join(live, temporaryPath),
              await stat(join(live, temporaryPath))
            ),
            expectedFile: currentSnapshot.files.find((file) => file.path === 'asset.txt')!,
            state: temporaryState
          },
          operationIndex: 0,
          operationState: 'applying'
        }
      })

      await recoverMarkedSkillTransactions({ reservedRoot, record })

      expect((await observeSkillPackage(live)).observedDigest).toBe(snapshot.packageDigest)
      await expect(stat(join(live, temporaryPath))).rejects.toMatchObject({ code: 'ENOENT' })
    }
  )

  it('does not overwrite unknown content with a different physical identity', async () => {
    const { root, live, record, snapshot } = await fixture()
    const reservedRoot = join(root, '.orca-skill-transactions')
    const transaction = join(reservedRoot, 'independent-replacement')
    await cp(live, join(transaction, 'backup'), { recursive: true })
    await writePublishingMarker({
      transaction,
      record,
      prior: snapshot,
      stageSource: live
    })
    await rm(live, { recursive: true })
    await mkdir(live, { recursive: true })
    await writeFile(join(live, 'SKILL.md'), 'independently replaced')

    await expect(recoverMarkedSkillTransactions({ reservedRoot, record })).rejects.toThrow(
      'skill-transaction-recovery-required'
    )
    expect(await readFile(join(live, 'SKILL.md'), 'utf8')).toBe('independently replaced')
  })

  it('fails closed when the approved parent is replaced by a link before recovery', async () => {
    const { root, live, record, snapshot } = await fixture()
    const reservedRoot = join(root, '.orca-skill-transactions')
    const transaction = join(reservedRoot, 'parent-link-swap')
    const originalSkills = join(root, 'original-skills')
    const outsideSkills = join(root, 'outside-skills')
    await cp(live, join(transaction, 'backup'), { recursive: true })
    await writePublishingMarker({
      transaction,
      record,
      prior: snapshot,
      stageSource: live
    })
    await writeFile(join(live, 'SKILL.md'), 'interrupted publication')
    await mkdir(outsideSkills)
    await rename(join(root, 'skills'), originalSkills)
    await symlink(
      outsideSkills,
      join(root, 'skills'),
      process.platform === 'win32' ? 'junction' : 'dir'
    )

    await expect(recoverMarkedSkillTransactions({ reservedRoot, record })).rejects.toThrow(
      'skill-topology-changed'
    )
    await expect(readFile(join(outsideSkills, 'orca-cli', 'SKILL.md'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('recovers the one marker-owned package-swap gap with an absent destination', async () => {
    const { root, live, record, snapshot } = await fixture()
    const reservedRoot = join(root, '.orca-skill-transactions')
    const transaction = join(reservedRoot, 'swap-gap')
    await writeSwapMarker({
      transaction,
      record,
      snapshot,
      stageSource: live,
      step: 'moving-stage'
    })
    await rename(live, join(transaction, 'old-live'))

    await recoverMarkedSkillTransactions({ reservedRoot, record })

    expect((await observeSkillPackage(live)).observedDigest).toBe(snapshot.packageDigest)
    await expect(stat(transaction)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects an absent destination outside the package-swap gap phase', async () => {
    const { root, live, record, snapshot } = await fixture()
    const reservedRoot = join(root, '.orca-skill-transactions')
    const transaction = join(reservedRoot, 'invalid-swap-gap')
    await writeSwapMarker({
      transaction,
      record,
      snapshot,
      stageSource: live,
      step: 'complete'
    })
    await rename(live, join(transaction, 'old-live'))

    await expect(recoverMarkedSkillTransactions({ reservedRoot, record })).rejects.toThrow(
      'skill-transaction-recovery-required'
    )
    expect(await stat(join(transaction, 'old-live'))).toBeTruthy()
  })

  it('retains the package-swap gap when old-live was edited in place', async () => {
    const { root, live, record, snapshot } = await fixture()
    const reservedRoot = join(root, '.orca-skill-transactions')
    const transaction = join(reservedRoot, 'edited-old-live')
    await writeSwapMarker({
      transaction,
      record,
      snapshot,
      stageSource: live,
      step: 'moving-stage'
    })
    const oldLive = join(transaction, 'old-live')
    await rename(live, oldLive)
    await writeFile(join(oldLive, 'SKILL.md'), 'independent same-inode edit')

    await expect(recoverMarkedSkillTransactions({ reservedRoot, record })).rejects.toThrow(
      'skill-transaction-recovery-required'
    )
    expect(await readFile(join(oldLive, 'SKILL.md'), 'utf8')).toBe('independent same-inode edit')
  })

  it('rejects an exact stage copy whose recorded physical identity was replaced', async () => {
    const { root, live, record, snapshot } = await fixture()
    const reservedRoot = join(root, '.orca-skill-transactions')
    const transaction = join(reservedRoot, 'replaced-stage')
    await writeSwapMarker({
      transaction,
      record,
      snapshot,
      stageSource: live,
      step: 'moving-stage'
    })
    await rename(live, join(transaction, 'old-live'))
    const stage = join(transaction, 'stage')
    const replacement = join(transaction, 'replacement-stage')
    await cp(stage, replacement, { recursive: true })
    await rm(stage, { recursive: true })
    await rename(replacement, stage)

    await expect(recoverMarkedSkillTransactions({ reservedRoot, record })).rejects.toThrow(
      'skill-transaction-recovery-required'
    )
    await expect(stat(live)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rolls back a completed package swap without losing the original identity', async () => {
    const { root, live, record, snapshot } = await fixture()
    const reservedRoot = join(root, '.orca-skill-transactions')
    const transaction = join(reservedRoot, 'completed-swap')
    await writeSwapMarker({
      transaction,
      record,
      snapshot,
      stageSource: live,
      step: 'complete'
    })
    await rename(live, join(transaction, 'old-live'))
    await rename(join(transaction, 'stage'), live)

    await recoverMarkedSkillTransactions({ reservedRoot, record })

    expect(skillPhysicalIdentity(live, await stat(live))).toBe(record.physicalIdentity)
    expect((await observeSkillPackage(live)).observedDigest).toBe(snapshot.packageDigest)
  })

  it('recovers when the stage rename completed before its journal advancement', async () => {
    const { root, live, record, snapshot } = await fixture()
    const reservedRoot = join(root, '.orca-skill-transactions')
    const transaction = join(reservedRoot, 'stage-rename-boundary')
    await writeSwapMarker({
      transaction,
      record,
      snapshot,
      stageSource: live,
      step: 'moving-stage'
    })
    await rename(live, join(transaction, 'old-live'))
    await rename(join(transaction, 'stage'), live)

    await recoverMarkedSkillTransactions({ reservedRoot, record })

    expect(skillPhysicalIdentity(live, await stat(live))).toBe(record.physicalIdentity)
    expect((await observeSkillPackage(live)).observedDigest).toBe(snapshot.packageDigest)
  })

  it('reclaims only a marked lock whose owner process is gone', async () => {
    const { root } = await fixture()
    const lockRoot = join(root, 'lock')
    await mkdir(lockRoot)
    await writeFile(
      join(lockRoot, 'owner.json'),
      JSON.stringify({
        schemaVersion: 1,
        pid: 2_147_483_647,
        lockId: '00000000-0000-4000-8000-000000000000',
        createdAt: 1,
        physicalIdentity: skillPhysicalIdentity(lockRoot, await stat(lockRoot))
      })
    )

    const release = await acquireSkillDestinationLock(lockRoot)
    expect(JSON.parse(await readFile(join(lockRoot, 'owner.json'), 'utf8')).pid).toBe(process.pid)
    await release()
  })

  it('does not release a lock whose exact ownership marker changed', async () => {
    const { root } = await fixture()
    const lockRoot = join(root, 'lock')
    const release = await acquireSkillDestinationLock(lockRoot)
    const owner = JSON.parse(await readFile(join(lockRoot, 'owner.json'), 'utf8'))
    await writeFile(
      join(lockRoot, 'owner.json'),
      JSON.stringify({ ...owner, lockId: '11111111-1111-4111-8111-111111111111' })
    )

    await expect(release()).rejects.toThrow('skill-update-lock-changed')
    expect(await lstat(lockRoot)).toBeTruthy()
  })

  it('removes its exact unmarked lock when authority fails during acquisition', async () => {
    const { root } = await fixture()
    const lockRoot = join(root, 'lock')
    let authorityChecks = 0

    await expect(
      acquireSkillDestinationLock(lockRoot, async () => {
        authorityChecks += 1
        if (authorityChecks === 2) {
          throw new Error('skill-topology-changed')
        }
      })
    ).rejects.toThrow('skill-topology-changed')

    expect(await lstat(lockRoot).catch(() => null)).toBeNull()
  })

  it('restores a self-contained orphan before inventory has loaded a ledger', async () => {
    const { root, live, record, snapshot } = await fixture()
    const reservedRoot = join(root, '.orca-skill-transactions')
    const transaction = join(reservedRoot, 'orphan')
    const unmarked = join(reservedRoot, 'keep-me')
    await cp(live, join(transaction, 'backup'), { recursive: true })
    await mkdir(unmarked, { recursive: true })
    await writePublishingMarker({
      transaction,
      record,
      prior: snapshot,
      stageSource: live
    })
    await writeFile(join(live, 'SKILL.md'), 'interrupted publication')

    await expect(
      sweepOrphanedSkillTransactions(join(root, 'skills'), emptySkillManagementLedger())
    ).rejects.toThrow('skill-transaction-recovery-required')

    expect(await readFile(join(live, 'SKILL.md'), 'utf8')).toBe('interrupted publication')
    expect(await readFile(join(transaction, 'transaction.json'), 'utf8')).toBeTruthy()
    expect(await import('node:fs/promises').then(({ stat }) => stat(unmarked))).toBeTruthy()
  })

  it('leaves a transaction untouched while its destination lock is live', async () => {
    const { root, record, snapshot } = await fixture()
    const reservedRoot = join(root, '.orca-skill-transactions')
    const transaction = join(reservedRoot, 'busy')
    await mkdir(transaction, { recursive: true })
    await writeSkillTransactionMarker(transaction, marker(record, snapshot, 'staging'))
    await mkdir(join(reservedRoot, 'locks'), { recursive: true })
    const release = await acquireSkillDestinationLock(join(reservedRoot, 'locks', record.id))

    await sweepOrphanedSkillTransactions(join(root, 'skills'), emptySkillManagementLedger())

    expect(
      parseSkillTransactionMarker(await readFile(join(transaction, 'transaction.json'), 'utf8'))
    ).not.toBeNull()
    await release()
  })

  it('does not sweep the reserved location for a different mount topology', async () => {
    const { root, record, snapshot } = await fixture()
    const transaction = join(root, 'skills', '.orca-skill-transactions', 'wrong-workspace')
    await mkdir(transaction, { recursive: true })
    await writeSkillTransactionMarker(transaction, marker(record, snapshot, 'staging'))

    await sweepOrphanedSkillTransactions(join(root, 'skills'), emptySkillManagementLedger())

    expect(await readFile(join(transaction, 'transaction.json'), 'utf8')).toBeTruthy()
  })

  it('ignores a valid marker whose destination is outside the approved root', async () => {
    const { root, snapshot } = await fixture()
    const outside = join(root, 'outside', 'orca-cli')
    await mkdir(outside, { recursive: true })
    const outsideRecord = {
      id: skillDestinationId('local', outside, 'orca-cli'),
      hostId: 'local',
      skillName: 'orca-cli',
      resolvedPath: outside,
      physicalIdentity: 'outside-identity'
    } as ManagedSkillDestination
    const transaction = join(root, '.orca-skill-transactions', 'outside-target')
    await mkdir(transaction, { recursive: true })
    await writeSkillTransactionMarker(transaction, marker(outsideRecord, snapshot, 'staging'))

    await sweepOrphanedSkillTransactions(join(root, 'skills'), emptySkillManagementLedger())

    expect(await readFile(join(transaction, 'transaction.json'), 'utf8')).toBeTruthy()
  })
})

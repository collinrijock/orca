import { mkdir, readFile, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type {
  ManagedSkillDestination,
  SkillCurrentBundleEntry
} from '../../shared/skill-management'
import { skillPhysicalIdentity } from './skill-installation-topology'
import {
  matchingReleasedSnapshot,
  observeSkillPackage,
  persistedObservedFiles
} from './skill-package-identity'
import {
  acquireSkillDestinationLock,
  recoverMarkedSkillTransactions
} from './skill-transaction-recovery'
import { destinationUsesCrlf, replaceSkillPackage } from './skill-package-publication'
import type { SkillRenameRuntime } from './skill-transaction-rename'
import { createSkillTransactionContext } from './skill-package-transaction-context'
import { parseSkillTransactionMarker } from './skill-transaction-marker'
import {
  assertManagedDestinationUnchanged,
  assertPublishedDestinationOwned
} from './skill-published-destination-authority'
import { recoverTransactionToPrior } from './skill-transaction-restore'
import { buildSkillTransactionPackage } from './skill-transaction-package-build'
import { assertSkillTransactionWorkspace } from './skill-transaction-workspace'

export async function publishBundledSkill(args: {
  record: ManagedSkillDestination
  current: SkillCurrentBundleEntry
  releasedSnapshots: Parameters<typeof matchingReleasedSnapshot>[1]
  packagesRoot: string
  commit: (destination: ManagedSkillDestination) => void | Promise<void>
  now?: number
  beforeDurableCommitValidation?: () => void | Promise<void>
  beforeWorkspaceCreationValidation?: () => void | Promise<void>
  publicationRenameRuntime?: SkillRenameRuntime
}): Promise<ManagedSkillDestination> {
  if (args.current.releaseRevision <= args.record.installedReleaseRevision) {
    await assertManagedDestinationUnchanged(args.record, args.releasedSnapshots)
    await args.commit(args.record)
    return args.record
  }
  await assertManagedDestinationUnchanged(args.record, args.releasedSnapshots)
  const transaction = await createSkillTransactionContext({
    record: args.record,
    current: args.current,
    releasedSnapshots: args.releasedSnapshots,
    now: args.now ?? Date.now(),
    beforeWorkspaceValidation: args.beforeWorkspaceCreationValidation
  })
  // Why: no workspace directory may be created after a parent or mount swap.
  await transaction.assertAuthority(true)
  await mkdir(dirname(transaction.paths.lockRoot), { recursive: true })
  await transaction.assertAuthority(true)
  const releaseLock = await acquireSkillDestinationLock(transaction.paths.lockRoot, () =>
    transaction.assertAuthority(true)
  )
  let retainTransaction = false
  let publicationStarted = false
  let durableCommitCompleted = false
  try {
    await transaction.assertAuthority(true)
    await recoverMarkedSkillTransactions({
      reservedRoot: transaction.paths.reservedRoot,
      record: args.record
    })
    await transaction.assertAuthority(true)
    await mkdir(transaction.paths.transactionRoot, { recursive: true })
    await transaction.assertAuthority(true)
    await transaction.writeMarker('staging', true)
    await buildSkillTransactionPackage({
      sourceRoot: join(args.packagesRoot, args.record.skillName),
      root: transaction.paths.stageRoot,
      snapshot: transaction.marker('staging').currentSnapshot,
      crlf: destinationUsesCrlf(args.record),
      assertSourceAuthority: () => transaction.assertAuthority(true),
      journal: transaction.journalStageBuild,
      assertBoundary: transaction.assertStageBuild
    })
    await buildSkillTransactionPackage({
      sourceRoot: args.record.resolvedPath,
      root: transaction.paths.backupRoot,
      snapshot: transaction.priorSnapshot,
      crlf: false,
      assertSourceAuthority: () => transaction.assertAuthority(true),
      journal: transaction.journalBackupBuild,
      assertBoundary: transaction.assertBackupBuild
    })
    await transaction.assertAuthority(true)
    publicationStarted = true
    await replaceSkillPackage({
      ...args,
      prior: transaction.priorSnapshot,
      stageRoot: transaction.paths.stageRoot,
      transactionRoot: transaction.paths.transactionRoot,
      callbacks: transaction.callbacks,
      renameRuntime: args.publicationRenameRuntime
    })
    const installed = await observeSkillPackage(args.record.resolvedPath)
    if (!matchingReleasedSnapshot(installed, [args.current])) {
      throw new Error('published-skill-package-invalid')
    }
    const now = args.now ?? Date.now()
    const publishingMarker = transaction.marker('publishing')
    const nextResolvedPath = await assertPublishedDestinationOwned({
      record: args.record,
      transactionRoot: transaction.paths.transactionRoot,
      marker: publishingMarker
    })
    const nextPhysicalIdentity = skillPhysicalIdentity(
      nextResolvedPath,
      await stat(nextResolvedPath)
    )
    const destination: ManagedSkillDestination = {
      ...args.record,
      resolvedPath: nextResolvedPath,
      physicalIdentity: nextPhysicalIdentity,
      installedReleaseRevision: args.current.releaseRevision,
      installedPackageDigest: args.current.packageDigest,
      installedFiles: persistedObservedFiles(installed),
      lastWrittenPackageDigest: args.current.packageDigest,
      lastAttemptedBundleFingerprint: args.current.packageDigest,
      lastOutcome: 'updated',
      lastErrorCategory: null,
      updatedAt: now
    }
    const verifiedMarker = transaction.marker('verified')
    await transaction.writeVerifiedMarker(async () => {
      await assertPublishedDestinationOwned({
        record: args.record,
        transactionRoot: transaction.paths.transactionRoot,
        marker: verifiedMarker
      })
    })
    // Why: the rollback package remains marked until durable Orca ownership
    // state agrees with the verified live package.
    await args.beforeDurableCommitValidation?.()
    await assertPublishedDestinationOwned({
      record: args.record,
      transactionRoot: transaction.paths.transactionRoot,
      marker: verifiedMarker
    })
    await args.commit(destination)
    durableCommitCompleted = true
    return destination
  } catch (error) {
    try {
      await recoverTransactionToPrior({
        transactionRoot: transaction.paths.transactionRoot,
        marker: transaction.marker(publicationStarted ? 'publishing' : 'staging'),
        assertParentAuthority: transaction.assertParentAuthority,
        currentDisposition: 'restore'
      })
    } catch (restoreError) {
      retainTransaction = true
      throw new AggregateError([error, restoreError], 'skill-transaction-recovery-required')
    }
    throw error
  } finally {
    const workspaceSafe = await assertSkillTransactionWorkspace(args.record, transaction.workspace)
      .then(() => true)
      .catch(() => false)
    if (workspaceSafe && !retainTransaction) {
      const cleanupMarker = await readFile(
        join(transaction.paths.transactionRoot, 'transaction.json'),
        'utf8'
      )
        .then(parseSkillTransactionMarker)
        .catch(() => null)
      if (cleanupMarker?.transactionId === transaction.marker('staging').transactionId) {
        try {
          // Why: cleanup repeats recovery from the durable marker immediately
          // before recursive removal, including after an ambiguous rollback.
          await recoverTransactionToPrior({
            transactionRoot: transaction.paths.transactionRoot,
            marker: cleanupMarker,
            assertParentAuthority: transaction.assertParentAuthority,
            currentDisposition: durableCommitCompleted ? 'committed' : 'restore'
          })
          await rm(transaction.paths.transactionRoot, { recursive: true, force: true })
        } catch {
          retainTransaction = true
        }
      }
    }
    if (workspaceSafe) {
      await releaseLock().catch(() => undefined)
    }
  }
}

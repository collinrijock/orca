import { lstat, mkdir, readFile, readdir, realpath, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { SkillManagementLedger } from '../../shared/skill-management'
import { normalizedSkillIdentityPath, skillPhysicalIdentity } from './skill-installation-topology'
import {
  parseSkillTransactionMarker,
  type SkillTransactionMarker
} from './skill-transaction-marker'
import { acquireSkillDestinationLock } from './skill-transaction-recovery'
import { recoverTransactionToPrior } from './skill-transaction-restore'
import { skillTransactionReservedRoot } from './skill-transaction-workspace'

async function assertApprovedDestinationParent(
  marker: SkillTransactionMarker,
  rootIdentity: string,
  rootPhysicalIdentity: string
): Promise<void> {
  if (normalizedSkillIdentityPath(dirname(resolve(marker.destinationPath))) !== rootIdentity) {
    throw new Error('skill-transaction-destination-outside-root')
  }
  const [parentStat, parentIdentity] = await Promise.all([
    lstat(dirname(marker.destinationPath)),
    realpath(dirname(marker.destinationPath)).then(normalizedSkillIdentityPath)
  ])
  if (
    parentStat.isSymbolicLink() ||
    parentIdentity !== rootIdentity ||
    skillPhysicalIdentity(dirname(marker.destinationPath), parentStat) !== rootPhysicalIdentity
  ) {
    throw new Error('skill-transaction-destination-outside-root')
  }
}

export async function sweepOrphanedSkillTransactions(
  approvedSkillsRoot: string,
  ledger: SkillManagementLedger
): Promise<void> {
  const roots = await Promise.all([
    lstat(approvedSkillsRoot),
    lstat(dirname(approvedSkillsRoot)),
    realpath(approvedSkillsRoot),
    realpath(dirname(approvedSkillsRoot))
  ]).catch(() => null)
  if (
    !roots ||
    roots[0].isSymbolicLink() ||
    roots[1].isSymbolicLink() ||
    normalizedSkillIdentityPath(dirname(roots[2])) !== normalizedSkillIdentityPath(roots[3])
  ) {
    return
  }
  const [skillsRootStat, parentRootStat, resolvedSkillsRoot] = roots
  const rootIdentity = normalizedSkillIdentityPath(resolvedSkillsRoot)
  const rootPhysicalIdentity = skillPhysicalIdentity(approvedSkillsRoot, skillsRootStat)
  // Why: mount changes invalidate the old workspace authority; sweeping both
  // possible locations could mutate a directory Orca did not reserve now.
  const reservedRoots = [
    skillTransactionReservedRoot({
      skillsRoot: approvedSkillsRoot,
      skillsRootDevice: skillsRootStat.dev,
      parentRoot: dirname(approvedSkillsRoot),
      parentRootDevice: parentRootStat.dev
    })
  ]
  for (const reservedRoot of reservedRoots) {
    const reservedRootSafe = await lstat(reservedRoot)
      .then((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .catch(() => false)
    if (!reservedRootSafe) {
      continue
    }
    const entries = await readdir(reservedRoot, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'locks') {
        continue
      }
      const transactionRoot = join(reservedRoot, entry.name)
      const marker = await readFile(join(transactionRoot, 'transaction.json'), 'utf8')
        .then(parseSkillTransactionMarker)
        .catch(() => null)
      if (!marker || marker.hostId !== 'local') {
        continue
      }
      try {
        await assertApprovedDestinationParent(marker, rootIdentity, rootPhysicalIdentity)
      } catch {
        continue
      }
      let release: (() => Promise<void>) | null = null
      try {
        const locksRoot = join(reservedRoot, 'locks')
        await mkdir(locksRoot, { recursive: true })
        const locksRootSafe = await lstat(locksRoot).then(
          (lockStat) => lockStat.isDirectory() && !lockStat.isSymbolicLink()
        )
        if (!locksRootSafe) {
          continue
        }
        release = await acquireSkillDestinationLock(join(locksRoot, marker.destinationId))
        const record = ledger.destinations[marker.destinationId]
        const committed = Boolean(
          marker.phase === 'verified' &&
          record?.hostId === marker.hostId &&
          normalizedSkillIdentityPath(record.resolvedPath) ===
            normalizedSkillIdentityPath(marker.destinationPath) &&
          record.installedPackageDigest === marker.currentSnapshot.packageDigest
        )
        await recoverTransactionToPrior({
          transactionRoot,
          marker,
          assertParentAuthority: () =>
            assertApprovedDestinationParent(marker, rootIdentity, rootPhysicalIdentity),
          currentDisposition: committed ? 'committed' : 'restore'
        })
        await rm(transactionRoot, { recursive: true, force: true })
      } catch {
        // Why: orphan sweeping is best-effort; retain this transaction's
        // evidence without preventing independent siblings from recovering.
      } finally {
        await release?.().catch(() => undefined)
      }
    }
  }
}

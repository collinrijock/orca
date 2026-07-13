import { lstat, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { ManagedSkillDestination } from '../../shared/skill-management'
import { skillPhysicalIdentity } from './skill-installation-topology'
import { observeSkillPackage } from './skill-package-identity'
import { rollbackSkillPackageSwap, type PublicationCallbacks } from './skill-package-publication'
import {
  clearSkillPublicationTemporary,
  rollbackSkillPackageInPlace
} from './skill-package-rollback'
import type { SkillTransactionMarker } from './skill-transaction-marker'
import { writeSkillTransactionMarker } from './skill-transaction-marker-write'
import { assertTransactionOwnedState } from './skill-transaction-owned-state'
import { assertSkillTransactionPackageBuild } from './skill-transaction-package-build'
import {
  matchingInPlaceOperationIndex,
  type SkillPublicationState
} from './skill-transaction-publication-state'
import { retrySkillRename } from './skill-transaction-rename'

export async function recoverTransactionToPrior(args: {
  transactionRoot: string
  marker: SkillTransactionMarker
  assertParentAuthority: () => Promise<void>
  currentDisposition: 'committed' | 'restore'
}): Promise<void> {
  if (args.marker.phase === 'staging') {
    await args.assertParentAuthority()
    for (const [rootName, evidence, snapshot] of [
      ['stage', args.marker.stageBuild, args.marker.currentSnapshot],
      ['backup', args.marker.backupBuild, args.marker.priorSnapshot]
    ] as const) {
      const root = join(args.transactionRoot, rootName)
      if (!evidence) {
        if (await lstat(root).catch(() => null)) {
          throw new Error('skill-transaction-recovery-required')
        }
        continue
      }
      await assertSkillTransactionPackageBuild({ root, evidence, snapshot }).catch(() => {
        throw new Error('skill-transaction-recovery-required')
      })
    }
    return
  }
  const record = { resolvedPath: args.marker.destinationPath } as ManagedSkillDestination
  let activeMarker = args.marker
  const assertOwned = () =>
    assertTransactionOwnedState({
      transactionRoot: args.transactionRoot,
      marker: activeMarker,
      assertParent: args.assertParentAuthority,
      allowAppliedOperation: true
    })
  const journal = async (publication: SkillPublicationState): Promise<void> => {
    activeMarker = { ...activeMarker, publication }
    await writeSkillTransactionMarker(
      args.transactionRoot,
      activeMarker,
      args.assertParentAuthority
    )
  }
  const assertBoundary: PublicationCallbacks['assertBoundary'] = async (
    publication,
    expectedLiveState
  ) => {
    const liveState = await assertTransactionOwnedState({
      transactionRoot: args.transactionRoot,
      marker: { ...activeMarker, publication },
      assertParent: args.assertParentAuthority,
      allowAppliedOperation: true
    })
    if (expectedLiveState && liveState !== expectedLiveState) {
      throw new Error('skill-transaction-recovery-required')
    }
  }
  const callbacks = { journal, assertBoundary }
  const state = await assertOwned()
  if (state === 'prior' || (state === 'current' && args.currentDisposition === 'committed')) {
    return
  }
  if (state === 'current' && activeMarker.publication?.kind === 'package-swap') {
    await rollbackSkillPackageSwap({
      record,
      transactionRoot: args.transactionRoot,
      callbacks
    })
  } else if (state === 'swap-absent') {
    const movingLive = { kind: 'package-swap', step: 'moving-live' } as const
    await retrySkillRename(
      join(args.transactionRoot, 'old-live'),
      args.marker.destinationPath,
      async () => {
        if ((await assertOwned()) !== 'swap-absent') {
          throw new Error('skill-transaction-recovery-required')
        }
      }
    )
    // Why: recovery journals both sides of the ambiguous rename before cleanup.
    await journal(movingLive)
  } else {
    if (activeMarker.publication?.kind === 'in-place') {
      await clearSkillPublicationTemporary({
        record,
        publication: activeMarker.publication,
        callbacks
      })
    }
    const observed = await observeSkillPackage(args.marker.destinationPath)
    const startingIndex = matchingInPlaceOperationIndex({
      observed,
      prior: args.marker.priorSnapshot,
      current: args.marker.currentSnapshot
    })
    if (startingIndex === null) {
      throw new Error('skill-transaction-recovery-required')
    }
    await rollbackSkillPackageInPlace({
      record,
      prior: args.marker.priorSnapshot,
      current: args.marker.currentSnapshot,
      backupRoot: join(args.transactionRoot, 'backup'),
      startingIndex,
      physicalIdentity: skillPhysicalIdentity(
        args.marker.destinationPath,
        await stat(args.marker.destinationPath)
      ),
      callbacks
    })
  }
  if ((await assertOwned()) !== 'prior') {
    throw new Error('skill-transaction-recovery-required')
  }
}

import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type {
  ManagedSkillDestination,
  SkillCurrentBundleEntry,
  SkillReleasedSnapshot
} from '../../shared/skill-management'
import { assertManagedSkillParentTopology } from './skill-installation-topology'
import type { PublicationCallbacks } from './skill-package-publication'
import { assertManagedDestinationUnchanged } from './skill-published-destination-authority'
import type { SkillTransactionMarker } from './skill-transaction-marker'
import { writeSkillTransactionMarker } from './skill-transaction-marker-write'
import { assertTransactionOwnedState } from './skill-transaction-owned-state'
import type { SkillPublicationState } from './skill-transaction-publication-state'
import {
  assertSkillTransactionPackageBuild,
  type SkillTransactionPackageBuildEvidence
} from './skill-transaction-package-build'
import {
  assertSkillTransactionWorkspace,
  resolveSkillTransactionWorkspace,
  type SkillTransactionWorkspace
} from './skill-transaction-workspace'

export type SkillTransactionContext = {
  workspace: SkillTransactionWorkspace
  paths: {
    reservedRoot: string
    transactionRoot: string
    stageRoot: string
    backupRoot: string
    lockRoot: string
  }
  priorSnapshot: SkillReleasedSnapshot
  callbacks: PublicationCallbacks
  assertAuthority: (checkContent: boolean) => Promise<void>
  assertParentAuthority: () => Promise<void>
  journalStageBuild: (evidence: SkillTransactionPackageBuildEvidence) => Promise<void>
  assertStageBuild: (evidence: SkillTransactionPackageBuildEvidence) => Promise<void>
  journalBackupBuild: (evidence: SkillTransactionPackageBuildEvidence) => Promise<void>
  assertBackupBuild: (evidence: SkillTransactionPackageBuildEvidence) => Promise<void>
  marker: (phase: SkillTransactionMarker['phase']) => SkillTransactionMarker
  writeMarker: (phase: SkillTransactionMarker['phase'], checkContent: boolean) => Promise<void>
  writeVerifiedMarker: (assertPublished: () => Promise<void>) => Promise<void>
}

export async function createSkillTransactionContext(args: {
  record: ManagedSkillDestination
  current: SkillCurrentBundleEntry
  releasedSnapshots: readonly SkillReleasedSnapshot[]
  now: number
  beforeWorkspaceValidation?: () => void | Promise<void>
}): Promise<SkillTransactionContext> {
  const workspace = await resolveSkillTransactionWorkspace(args.record)
  await args.beforeWorkspaceValidation?.()
  const assertAuthority = async (checkContent: boolean): Promise<void> => {
    if (checkContent) {
      await assertManagedDestinationUnchanged(args.record, args.releasedSnapshots)
    }
    await assertSkillTransactionWorkspace(args.record, workspace)
  }
  await assertAuthority(true)
  const reservedRoot = workspace.reservedRoot
  const transactionRoot = join(reservedRoot, randomUUID())
  const stageRoot = join(transactionRoot, 'stage')
  const backupRoot = join(transactionRoot, 'backup')
  const priorSnapshot: SkillReleasedSnapshot = {
    releaseRevision: args.record.installedReleaseRevision,
    packageDigest: args.record.installedPackageDigest,
    gitTreeSha: args.record.sourceRef ?? '',
    files: args.record.installedFiles
  }
  const currentSnapshot: SkillReleasedSnapshot = {
    releaseRevision: args.current.releaseRevision,
    packageDigest: args.current.packageDigest,
    gitTreeSha: args.current.gitTreeSha,
    files: args.current.files
  }
  let stagePhysicalIdentity: string | null = null
  let backupPhysicalIdentity: string | null = null
  let stageBuild: SkillTransactionPackageBuildEvidence | null = null
  let backupBuild: SkillTransactionPackageBuildEvidence | null = null
  let publication: SkillPublicationState | null = null
  const transactionId = randomUUID()
  const marker = (phase: SkillTransactionMarker['phase']): SkillTransactionMarker => ({
    schemaVersion: 1,
    transactionId,
    createdAt: args.now,
    destinationId: args.record.id,
    destinationPath: args.record.resolvedPath,
    physicalIdentity: args.record.physicalIdentity,
    hostId: args.record.hostId,
    skillName: args.record.skillName,
    phase,
    stagePhysicalIdentity,
    backupPhysicalIdentity,
    stageBuild,
    backupBuild,
    publication,
    priorSnapshot,
    currentSnapshot
  })
  const assertParentAuthority = () => assertManagedSkillParentTopology(args.record)
  const assertBuildAuthority = async (): Promise<void> => {
    await assertAuthority(true)
    if (stageBuild) {
      await assertSkillTransactionPackageBuild({
        root: stageRoot,
        evidence: stageBuild,
        snapshot: currentSnapshot
      })
    }
    if (backupBuild) {
      await assertSkillTransactionPackageBuild({
        root: backupRoot,
        evidence: backupBuild,
        snapshot: priorSnapshot
      })
    }
  }
  const writeBuildMarker = async (): Promise<void> => {
    await writeSkillTransactionMarker(transactionRoot, marker('staging'), assertBuildAuthority)
  }
  const journal = async (next: SkillPublicationState): Promise<void> => {
    publication = next
    await assertAuthority(false)
    await writeSkillTransactionMarker(transactionRoot, marker('publishing'), () =>
      assertAuthority(false)
    )
  }
  const assertBoundary: PublicationCallbacks['assertBoundary'] = async (
    state,
    expectedLiveState
  ) => {
    const liveState = await assertTransactionOwnedState({
      transactionRoot,
      marker: { ...marker('publishing'), publication: state },
      assertParent: assertParentAuthority,
      allowAppliedOperation: false
    })
    await assertAuthority(false)
    if (expectedLiveState && liveState !== expectedLiveState) {
      throw new Error('skill-transaction-recovery-required')
    }
  }
  return {
    workspace,
    paths: {
      reservedRoot,
      transactionRoot,
      stageRoot,
      backupRoot,
      lockRoot: join(reservedRoot, 'locks', args.record.id)
    },
    priorSnapshot,
    callbacks: { journal, assertBoundary },
    assertAuthority,
    assertParentAuthority,
    journalStageBuild: async (evidence) => {
      stageBuild = evidence
      stagePhysicalIdentity = evidence.physicalIdentity
      await writeBuildMarker()
    },
    assertStageBuild: async (evidence) => {
      await assertAuthority(true)
      await assertSkillTransactionPackageBuild({
        root: stageRoot,
        evidence,
        snapshot: currentSnapshot
      })
    },
    journalBackupBuild: async (evidence) => {
      backupBuild = evidence
      backupPhysicalIdentity = evidence.physicalIdentity
      await writeBuildMarker()
    },
    assertBackupBuild: async (evidence) => {
      await assertAuthority(true)
      await assertSkillTransactionPackageBuild({
        root: backupRoot,
        evidence,
        snapshot: priorSnapshot
      })
    },
    marker,
    writeMarker: async (phase, checkContent) => {
      await writeSkillTransactionMarker(transactionRoot, marker(phase), () =>
        assertAuthority(checkContent)
      )
    },
    writeVerifiedMarker: async (assertPublished) => {
      await writeSkillTransactionMarker(transactionRoot, marker('verified'), async () => {
        // Why: marker durability must never outlive the exact destination
        // identity and content proof it claims.
        await assertAuthority(false)
        await assertPublished()
      })
    }
  }
}

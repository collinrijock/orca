import { basename, isAbsolute, posix } from 'node:path'
import { normalizeExecutionHostId, type ExecutionHostId } from '../../shared/execution-host'
import type { SkillReleasedSnapshot } from '../../shared/skill-management'
import { normalizedSkillIdentityPath } from './skill-installation-topology'
import {
  isSkillTransactionPackageBuildEvidence,
  type SkillTransactionPackageBuildEvidence
} from './skill-transaction-package-build'
import {
  sameCompleteFileIdentity,
  skillInPlaceOperations,
  type SkillInPlacePublicationState,
  type SkillPublicationState
} from './skill-transaction-publication-state'
import {
  isSkillBundleFileIdentity,
  isSkillReleasedSnapshot
} from './skill-transaction-snapshot-validation'

export type SkillTransactionMarker = {
  schemaVersion: 1
  transactionId: string
  createdAt: number
  destinationId: string
  destinationPath: string
  physicalIdentity: string
  hostId: ExecutionHostId
  skillName: string
  phase: 'staging' | 'publishing' | 'verified'
  stagePhysicalIdentity: string | null
  backupPhysicalIdentity: string | null
  stageBuild: SkillTransactionPackageBuildEvidence | null
  backupBuild: SkillTransactionPackageBuildEvidence | null
  publication: SkillPublicationState | null
  priorSnapshot: SkillReleasedSnapshot
  currentSnapshot: SkillReleasedSnapshot
}

function validInPlaceSemantics(
  publication: SkillInPlacePublicationState,
  prior: SkillReleasedSnapshot,
  current: SkillReleasedSnapshot
): boolean {
  const operations = skillInPlaceOperations(prior, current)
  if (publication.operationIndex > operations.length) {
    return false
  }
  if (publication.operationState === 'ready') {
    return publication.temporary === null
  }
  const operation =
    operations[
      publication.direction === 'forward'
        ? publication.operationIndex
        : publication.operationIndex - 1
    ]
  if (!operation) {
    return false
  }
  const expected =
    publication.direction === 'forward'
      ? current.files.find((file) => file.path === operation.path)
      : prior.files.find((file) => file.path === operation.path)
  if (!publication.temporary) {
    return true
  }
  return Boolean(
    expected &&
    publication.temporary.path.startsWith(`${operation.path}.orca-`) &&
    sameCompleteFileIdentity(publication.temporary.expectedFile, expected)
  )
}

function validBuildSemantics(
  evidence: SkillTransactionPackageBuildEvidence | null,
  snapshot: SkillReleasedSnapshot
): boolean {
  if (!evidence) {
    return true
  }
  if (evidence.operationIndex > snapshot.files.length) {
    return false
  }
  if (evidence.state === 'ready') {
    return (
      evidence.operationIndex === snapshot.files.length &&
      evidence.pendingPath === null &&
      evidence.activeFile === null
    )
  }
  if (evidence.pendingPath !== null) {
    return (
      evidence.activeFile === null &&
      snapshot.files[evidence.operationIndex]?.path === evidence.pendingPath
    )
  }
  if (!evidence.activeFile) {
    return true
  }
  return snapshot.files[evidence.operationIndex]?.path === evidence.activeFile.path
}

function validMarkerSemantics(marker: SkillTransactionMarker): boolean {
  if (marker.currentSnapshot.releaseRevision <= marker.priorSnapshot.releaseRevision) {
    return false
  }
  if (
    !validBuildSemantics(marker.stageBuild, marker.currentSnapshot) ||
    !validBuildSemantics(marker.backupBuild, marker.priorSnapshot) ||
    marker.stagePhysicalIdentity !== (marker.stageBuild?.physicalIdentity ?? null) ||
    marker.backupPhysicalIdentity !== (marker.backupBuild?.physicalIdentity ?? null) ||
    (marker.backupBuild && marker.stageBuild?.state !== 'ready')
  ) {
    return false
  }
  if (!marker.publication) {
    return marker.phase === 'staging'
  }
  if (marker.stageBuild?.state !== 'ready' || marker.backupBuild?.state !== 'ready') {
    return false
  }
  if (
    marker.publication.kind === 'in-place' &&
    !validInPlaceSemantics(marker.publication, marker.priorSnapshot, marker.currentSnapshot)
  ) {
    return false
  }
  if (marker.phase !== 'verified') {
    return true
  }
  if (marker.publication.kind === 'package-swap') {
    return marker.publication.step === 'complete'
  }
  return (
    marker.publication.direction === 'forward' &&
    marker.publication.operationState === 'ready' &&
    marker.publication.temporary === null &&
    marker.publication.operationIndex ===
      skillInPlaceOperations(marker.priorSnapshot, marker.currentSnapshot).length
  )
}

function isPublicationState(value: unknown): value is SkillPublicationState {
  if (typeof value !== 'object' || value === null || !('kind' in value)) {
    return false
  }
  if (value.kind === 'in-place') {
    return (
      'operationIndex' in value &&
      typeof value.operationIndex === 'number' &&
      Number.isSafeInteger(value.operationIndex) &&
      value.operationIndex >= 0 &&
      'direction' in value &&
      (value.direction === 'forward' || value.direction === 'rollback') &&
      'physicalIdentity' in value &&
      typeof value.physicalIdentity === 'string' &&
      value.physicalIdentity.length > 0 &&
      'temporary' in value &&
      (value.temporary === null ||
        (typeof value.temporary === 'object' &&
          value.temporary !== null &&
          'path' in value.temporary &&
          typeof value.temporary.path === 'string' &&
          value.temporary.path.endsWith('.tmp') &&
          !posix.isAbsolute(value.temporary.path) &&
          posix.normalize(value.temporary.path) === value.temporary.path &&
          !value.temporary.path.split('/').includes('..') &&
          !value.temporary.path.includes('\\') &&
          'physicalIdentity' in value.temporary &&
          typeof value.temporary.physicalIdentity === 'string' &&
          value.temporary.physicalIdentity.length > 0 &&
          'state' in value.temporary &&
          (value.temporary.state === 'creating' ||
            value.temporary.state === 'written' ||
            value.temporary.state === 'ready' ||
            value.temporary.state === 'applied') &&
          'expectedFile' in value.temporary &&
          isSkillBundleFileIdentity(value.temporary.expectedFile))) &&
      'operationState' in value &&
      (value.operationState === 'ready' || value.operationState === 'applying')
    )
  }
  return (
    value.kind === 'package-swap' &&
    'step' in value &&
    (value.step === 'moving-live' ||
      value.step === 'live-moved' ||
      value.step === 'moving-stage' ||
      value.step === 'stage-moved' ||
      value.step === 'rollback-moving-current' ||
      value.step === 'rollback-current-moved' ||
      value.step === 'rollback-moving-old-live' ||
      value.step === 'complete')
  )
}

export function parseSkillTransactionMarker(value: string): SkillTransactionMarker | null {
  try {
    const parsed: unknown = JSON.parse(value)
    if (typeof parsed !== 'object' || parsed === null) {
      return null
    }
    const marker = parsed as Partial<SkillTransactionMarker>
    const hostId = normalizeExecutionHostId(marker.hostId)
    if (
      marker.schemaVersion !== 1 ||
      typeof marker.transactionId !== 'string' ||
      marker.transactionId.length === 0 ||
      typeof marker.createdAt !== 'number' ||
      !Number.isFinite(marker.createdAt) ||
      typeof marker.destinationId !== 'string' ||
      !/^[a-f0-9]{24}$/.test(marker.destinationId) ||
      typeof marker.destinationPath !== 'string' ||
      !isAbsolute(marker.destinationPath) ||
      typeof marker.physicalIdentity !== 'string' ||
      marker.physicalIdentity.length === 0 ||
      typeof marker.skillName !== 'string' ||
      marker.skillName.length === 0 ||
      (marker.stagePhysicalIdentity !== null &&
        (typeof marker.stagePhysicalIdentity !== 'string' ||
          marker.stagePhysicalIdentity.length === 0)) ||
      (marker.backupPhysicalIdentity !== null &&
        (typeof marker.backupPhysicalIdentity !== 'string' ||
          marker.backupPhysicalIdentity.length === 0)) ||
      (marker.stageBuild !== null && !isSkillTransactionPackageBuildEvidence(marker.stageBuild)) ||
      (marker.backupBuild !== null &&
        !isSkillTransactionPackageBuildEvidence(marker.backupBuild)) ||
      !hostId ||
      (marker.phase !== 'staging' &&
        marker.phase !== 'publishing' &&
        marker.phase !== 'verified') ||
      !isSkillReleasedSnapshot(marker.priorSnapshot) ||
      !isSkillReleasedSnapshot(marker.currentSnapshot)
    ) {
      return null
    }
    const validated = { ...marker, hostId } as SkillTransactionMarker
    if (!validMarkerSemantics(validated)) {
      return null
    }
    if (
      (marker.phase === 'staging' && marker.publication !== null) ||
      (marker.phase !== 'staging' && !isPublicationState(marker.publication)) ||
      (marker.phase !== 'staging' &&
        (marker.stageBuild?.state !== 'ready' || marker.backupBuild?.state !== 'ready'))
    ) {
      return null
    }
    if (
      normalizedSkillIdentityPath(basename(marker.destinationPath)) !==
      normalizedSkillIdentityPath(marker.skillName)
    ) {
      return null
    }
    return validated
  } catch {
    return null
  }
}

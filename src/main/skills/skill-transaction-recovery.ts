import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ManagedSkillDestination } from '../../shared/skill-management'
import {
  assertManagedSkillParentTopology,
  normalizedSkillIdentityPath,
  skillPhysicalIdentity
} from './skill-installation-topology'
import { parseSkillTransactionMarker } from './skill-transaction-marker'
import { recoverTransactionToPrior } from './skill-transaction-restore'

export async function recoverMarkedSkillTransactions(args: {
  reservedRoot: string
  record: ManagedSkillDestination
}): Promise<void> {
  const entries = await readdir(args.reservedRoot, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'locks') {
      continue
    }
    const transactionRoot = join(args.reservedRoot, entry.name)
    const marker = await readFile(join(transactionRoot, 'transaction.json'), 'utf8')
      .then(parseSkillTransactionMarker)
      .catch(() => null)
    const recordMatchesPrior = marker
      ? marker.priorSnapshot.packageDigest === args.record.installedPackageDigest
      : false
    const recordMatchesCurrent = marker
      ? marker.phase === 'verified' &&
        marker.currentSnapshot.packageDigest === args.record.installedPackageDigest
      : false
    if (
      !marker ||
      marker.destinationId !== args.record.id ||
      marker.hostId !== args.record.hostId ||
      marker.skillName !== args.record.skillName ||
      normalizedSkillIdentityPath(marker.destinationPath) !==
        normalizedSkillIdentityPath(args.record.resolvedPath) ||
      (!recordMatchesPrior && !recordMatchesCurrent)
    ) {
      continue
    }
    await recoverTransactionToPrior({
      transactionRoot,
      marker,
      assertParentAuthority: () => assertManagedSkillParentTopology(args.record),
      currentDisposition:
        marker.phase === 'verified' && recordMatchesCurrent ? 'committed' : 'restore'
    })
    await rm(transactionRoot, { recursive: true, force: true })
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'EPERM')
  }
}

type SkillDestinationLockOwner = {
  schemaVersion: 1
  pid: number
  lockId: string
  createdAt: number
  physicalIdentity: string
}

function parseSkillDestinationLockOwner(value: unknown): SkillDestinationLockOwner | null {
  if (
    !value ||
    typeof value !== 'object' ||
    !('schemaVersion' in value) ||
    value.schemaVersion !== 1 ||
    !('pid' in value) ||
    typeof value.pid !== 'number' ||
    !Number.isSafeInteger(value.pid) ||
    value.pid <= 0 ||
    !('lockId' in value) ||
    typeof value.lockId !== 'string' ||
    !/^[a-f0-9-]{36}$/.test(value.lockId) ||
    !('createdAt' in value) ||
    typeof value.createdAt !== 'number' ||
    !Number.isFinite(value.createdAt) ||
    !('physicalIdentity' in value) ||
    typeof value.physicalIdentity !== 'string' ||
    value.physicalIdentity.length === 0
  ) {
    return null
  }
  return value as SkillDestinationLockOwner
}

async function inspectSkillDestinationLock(lockRoot: string): Promise<SkillDestinationLockOwner> {
  const entry = await lstat(lockRoot).catch(() => null)
  if (!entry?.isDirectory() || entry.isSymbolicLink()) {
    throw new Error('skill-update-busy')
  }
  const owner = await readFile(join(lockRoot, 'owner.json'), 'utf8')
    .then((value) => parseSkillDestinationLockOwner(JSON.parse(value)))
    .catch(() => null)
  if (!owner || skillPhysicalIdentity(lockRoot, entry) !== owner.physicalIdentity) {
    throw new Error('skill-update-busy')
  }
  return owner
}

async function assertUnpublishedSkillDestinationLock(
  lockRoot: string,
  physicalIdentity: string
): Promise<void> {
  const [entry, children] = await Promise.all([
    lstat(lockRoot),
    readdir(lockRoot, { withFileTypes: true })
  ])
  if (
    !entry.isDirectory() ||
    entry.isSymbolicLink() ||
    skillPhysicalIdentity(lockRoot, entry) !== physicalIdentity ||
    children.some(
      (child) => child.name !== 'owner.json' || !child.isFile() || child.isSymbolicLink()
    )
  ) {
    throw new Error('skill-update-lock-changed')
  }
}

function sameSkillDestinationLockOwner(
  left: SkillDestinationLockOwner,
  right: SkillDestinationLockOwner
): boolean {
  return (
    left.pid === right.pid &&
    left.lockId === right.lockId &&
    left.createdAt === right.createdAt &&
    left.physicalIdentity === right.physicalIdentity
  )
}

export async function acquireSkillDestinationLock(
  lockRoot: string,
  beforeMutation: () => Promise<void> = async () => undefined
): Promise<() => Promise<void>> {
  const create = async (): Promise<SkillDestinationLockOwner> => {
    await beforeMutation()
    await mkdir(lockRoot)
    const entry = await lstat(lockRoot)
    const owner: SkillDestinationLockOwner = {
      schemaVersion: 1,
      pid: process.pid,
      lockId: randomUUID(),
      createdAt: Date.now(),
      physicalIdentity: skillPhysicalIdentity(lockRoot, entry)
    }
    try {
      await beforeMutation()
      if (skillPhysicalIdentity(lockRoot, await lstat(lockRoot)) !== owner.physicalIdentity) {
        throw new Error('skill-update-busy')
      }
      await writeFile(join(lockRoot, 'owner.json'), JSON.stringify(owner), { flag: 'wx' })
      return owner
    } catch (error) {
      // Why: a failed authority check or partial owner write must not leave an
      // unmarked lock that permanently wedges an otherwise retryable update.
      await assertUnpublishedSkillDestinationLock(lockRoot, owner.physicalIdentity)
        .then(() => rm(lockRoot, { recursive: true }))
        .catch(() => undefined)
      throw error
    }
  }
  let acquired: SkillDestinationLockOwner
  try {
    acquired = await create()
  } catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'EEXIST') {
      throw error
    }
    const owner = await inspectSkillDestinationLock(lockRoot)
    if (processIsAlive(owner.pid)) {
      throw new Error('skill-update-busy')
    }
    await beforeMutation()
    const currentOwner = await inspectSkillDestinationLock(lockRoot)
    // Why: a second Orca may reclaim and replace the stale lock while this
    // process proves destination authority; never remove its new lock.
    if (!sameSkillDestinationLockOwner(owner, currentOwner)) {
      throw new Error('skill-update-busy')
    }
    await rm(lockRoot, { recursive: true })
    acquired = await create()
  }
  return async () => {
    const currentOwner = await inspectSkillDestinationLock(lockRoot)
    if (!sameSkillDestinationLockOwner(acquired, currentOwner)) {
      throw new Error('skill-update-lock-changed')
    }
    await rm(lockRoot, { recursive: true })
  }
}

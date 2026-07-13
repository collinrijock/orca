import { randomUUID } from 'node:crypto'
import { lstat, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { skillPhysicalIdentity } from './skill-installation-topology'
import {
  parseSkillTransactionMarker,
  type SkillTransactionMarker
} from './skill-transaction-marker'

export async function writeSkillTransactionMarker(
  transactionRoot: string,
  marker: SkillTransactionMarker,
  beforeMutation: () => Promise<void> = async () => undefined
): Promise<void> {
  const markerPath = join(transactionRoot, 'transaction.json')
  const temporaryPath = join(transactionRoot, `.transaction-${randomUUID()}.tmp`)
  const serialized = JSON.stringify(marker)
  if (!parseSkillTransactionMarker(serialized)) {
    throw new Error('skill-transaction-marker-invalid')
  }
  let temporaryPhysicalIdentity: string | null = null
  const assertTemporaryOwned = async (): Promise<void> => {
    const entry = await lstat(temporaryPath)
    if (
      !entry.isFile() ||
      entry.isSymbolicLink() ||
      skillPhysicalIdentity(temporaryPath, entry) !== temporaryPhysicalIdentity
    ) {
      throw new Error('skill-transaction-marker-changed')
    }
  }
  const assertMarkerSlotOwned = async (): Promise<void> => {
    const entry = await lstat(markerPath).catch((error) => {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        return null
      }
      throw error
    })
    if (!entry) {
      return
    }
    const current =
      entry.isFile() && !entry.isSymbolicLink()
        ? await readFile(markerPath, 'utf8')
            .then(parseSkillTransactionMarker)
            .catch(() => null)
        : null
    if (current?.transactionId !== marker.transactionId) {
      throw new Error('skill-transaction-marker-changed')
    }
  }
  try {
    await beforeMutation()
    await writeFile(temporaryPath, serialized, { flag: 'wx' })
    temporaryPhysicalIdentity = skillPhysicalIdentity(temporaryPath, await lstat(temporaryPath))
    // Why: recovery must observe either the old or new phase, never a torn
    // marker that could discard the only verified rollback package.
    await beforeMutation()
    await assertMarkerSlotOwned()
    await assertTemporaryOwned()
    await rename(temporaryPath, markerPath)
  } finally {
    if (
      temporaryPhysicalIdentity &&
      (await beforeMutation()
        .then(() => true)
        .catch(() => false))
    ) {
      // Why: a redirected or independently replaced temporary is not
      // transaction-owned cleanup, even though its randomized name matches.
      await assertTemporaryOwned()
        .then(() => unlink(temporaryPath))
        .catch(() => undefined)
    }
  }
}

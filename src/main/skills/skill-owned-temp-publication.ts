import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, type FileHandle } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { SkillBundleFileIdentity } from '../../shared/skill-management'
import { skillPhysicalIdentity } from './skill-installation-topology'
import { describeObservedSkillFile, matchesFileIdentity } from './skill-package-identity'
import type { PublicationCallbacks } from './skill-package-publication'
import { retrySkillRename } from './skill-transaction-rename'

export type SkillOwnedTempRuntime = {
  readSource?: (path: string) => Promise<Buffer>
  writeBytes?: (handle: FileHandle, bytes: Buffer) => Promise<void>
  chmodTemp?: (handle: FileHandle, mode: number) => Promise<void>
  syncTemp?: (handle: FileHandle) => Promise<void>
}

export async function publishSkillFileThroughOwnedTemp(args: {
  destinationRoot: string
  sourcePath: string
  expectedFile: SkillBundleFileIdentity
  direction: 'forward' | 'rollback'
  packagePhysicalIdentity: string
  operationIndex: number
  callbacks: PublicationCallbacks
  runtime?: SkillOwnedTempRuntime
}): Promise<void> {
  const livePath = join(args.destinationRoot, ...args.expectedFile.path.split('/'))
  const temporaryRelativePath = `${args.expectedFile.path}.orca-${randomUUID()}.tmp`
  const temporaryPath = join(args.destinationRoot, ...temporaryRelativePath.split('/'))
  const applying = {
    kind: 'in-place',
    direction: args.direction,
    physicalIdentity: args.packagePhysicalIdentity,
    temporary: null,
    operationIndex: args.operationIndex,
    operationState: 'applying'
  } as const
  await args.callbacks.assertBoundary(applying)
  await mkdir(dirname(livePath), { recursive: true })
  await args.callbacks.assertBoundary(applying)
  const mode = args.expectedFile.executable ? 0o755 : 0o644
  const handle = await open(temporaryPath, 'wx', mode)
  const ready = await (async () => {
    let completed = false
    try {
      const creating = {
        ...applying,
        temporary: {
          path: temporaryRelativePath,
          physicalIdentity: skillPhysicalIdentity(temporaryPath, await handle.stat()),
          expectedFile: args.expectedFile,
          state: 'creating'
        }
      } as const
      // Why: partial bytes are recoverable only after the exclusively created
      // inode is durably recorded as transaction-owned.
      await args.callbacks.journal(creating)
      await args.callbacks.assertBoundary(creating)
      const bytes = await (args.runtime?.readSource ?? readFile)(args.sourcePath)
      if (
        !matchesFileIdentity(
          describeObservedSkillFile(args.expectedFile.path, bytes, args.expectedFile.executable),
          args.expectedFile
        )
      ) {
        throw new Error('skill-owned-temp-source-changed')
      }
      await args.callbacks.assertBoundary(creating)
      await (args.runtime?.writeBytes ?? ((target, value) => target.writeFile(value)))(
        handle,
        bytes
      )
      const written = {
        ...creating,
        temporary: { ...creating.temporary, state: 'written' as const }
      }
      await args.callbacks.assertBoundary(written)
      await args.callbacks.journal(written)
      if (process.platform !== 'win32') {
        await args.callbacks.assertBoundary(written)
        await (args.runtime?.chmodTemp ?? ((target, nextMode) => target.chmod(nextMode)))(
          handle,
          mode
        )
      }
      const readyState = {
        ...written,
        temporary: { ...written.temporary, state: 'ready' as const }
      }
      await args.callbacks.assertBoundary(readyState)
      await args.callbacks.journal(readyState)
      await args.callbacks.assertBoundary(readyState)
      await (args.runtime?.syncTemp ?? ((target) => target.sync()))(handle)
      await args.callbacks.assertBoundary(readyState)
      completed = true
      return readyState
    } finally {
      const closing = handle.close()
      await (completed ? closing : closing.catch(() => undefined))
    }
  })()
  await args.callbacks.assertBoundary(ready)
  await retrySkillRename(temporaryPath, livePath, () => args.callbacks.assertBoundary(ready))
  const applied = {
    ...ready,
    temporary: { ...ready.temporary, state: 'applied' as const }
  }
  await args.callbacks.assertBoundary(applied)
  await args.callbacks.journal(applied)
  // Why: do not discard the temp inode proof if another writer replaces the
  // exact-content target while the applied marker is being persisted.
  await args.callbacks.assertBoundary(applied)
}

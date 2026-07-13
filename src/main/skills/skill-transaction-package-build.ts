import { lstat, mkdir, open, readFile, readdir, stat, type FileHandle } from 'node:fs/promises'
import { dirname, join, posix } from 'node:path'
import type { SkillBundleFileIdentity, SkillReleasedSnapshot } from '../../shared/skill-management'
import { skillPhysicalIdentity } from './skill-installation-topology'
import {
  describeObservedSkillFile,
  matchesFileIdentity,
  observeSkillPackage
} from './skill-package-identity'

export type SkillTransactionPackageBuildEvidence = {
  state: 'creating' | 'ready'
  physicalIdentity: string
  operationIndex: number
  pendingPath: string | null
  activeFile: {
    path: string
    physicalIdentity: string
    contentState: 'created' | 'written' | 'ready'
  } | null
}

export type SkillTransactionPackageBuildRuntime = {
  createRoot?: (path: string) => Promise<void>
  createParent?: (path: string) => Promise<void>
  openFile?: (path: string, mode: number) => Promise<FileHandle>
  readSource?: (path: string) => Promise<Buffer>
  writeBytes?: (handle: FileHandle, bytes: Buffer) => Promise<void>
  chmodFile?: (handle: FileHandle, mode: number) => Promise<void>
  syncFile?: (handle: FileHandle) => Promise<void>
}

export function isSkillTransactionPackageBuildEvidence(
  value: unknown
): value is SkillTransactionPackageBuildEvidence {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const evidence = value as Partial<SkillTransactionPackageBuildEvidence>
  const validPath = (path: unknown): path is string =>
    typeof path === 'string' &&
    path.length > 0 &&
    !path.includes('\\') &&
    !posix.isAbsolute(path) &&
    posix.normalize(path) === path &&
    !path.split('/').includes('..')
  const activeFile = evidence.activeFile
  return Boolean(
    (evidence.state === 'creating' || evidence.state === 'ready') &&
    typeof evidence.physicalIdentity === 'string' &&
    evidence.physicalIdentity.length > 0 &&
    typeof evidence.operationIndex === 'number' &&
    Number.isSafeInteger(evidence.operationIndex) &&
    evidence.operationIndex >= 0 &&
    (evidence.pendingPath === null || validPath(evidence.pendingPath)) &&
    (activeFile === null ||
      (typeof activeFile === 'object' &&
        activeFile !== null &&
        validPath(activeFile.path) &&
        typeof activeFile.physicalIdentity === 'string' &&
        activeFile.physicalIdentity.length > 0 &&
        (activeFile.contentState === 'created' ||
          activeFile.contentState === 'written' ||
          activeFile.contentState === 'ready')))
  )
}

function expectedDirectories(paths: readonly string[]): Set<string> {
  const directories = new Set<string>()
  for (const path of paths) {
    const parts = path.split('/')
    for (let index = 1; index < parts.length; index += 1) {
      directories.add(parts.slice(0, index).join('/'))
    }
  }
  return directories
}

async function assertDirectoryShape(root: string, paths: readonly string[]): Promise<void> {
  const allowed = expectedDirectories(paths)
  const visit = async (directory: string, relativeDirectory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (!allowed.has(relativePath)) {
          throw new Error('skill-transaction-package-build-changed')
        }
        await visit(join(directory, entry.name), relativePath)
      } else if (!entry.isFile()) {
        throw new Error('skill-transaction-package-build-changed')
      }
    }
  }
  await visit(root, '')
}

function matchesPrefix(
  observed: Awaited<ReturnType<typeof observeSkillPackage>>,
  snapshot: SkillReleasedSnapshot,
  count: number
): boolean {
  return (
    observed.files.length === count &&
    snapshot.files
      .slice(0, count)
      .every((expected, index) => matchesFileIdentity(observed.files[index]!, expected))
  )
}

export async function assertSkillTransactionPackageBuild(args: {
  root: string
  evidence: SkillTransactionPackageBuildEvidence
  snapshot: SkillReleasedSnapshot
}): Promise<void> {
  const rootEntry = await lstat(args.root)
  if (
    !rootEntry.isDirectory() ||
    rootEntry.isSymbolicLink() ||
    skillPhysicalIdentity(args.root, rootEntry) !== args.evidence.physicalIdentity
  ) {
    throw new Error('skill-transaction-package-build-changed')
  }
  const observed = await observeSkillPackage(args.root)
  const expectedPaths = args.snapshot.files
    .slice(0, args.evidence.operationIndex)
    .map((file) => file.path)
  if (args.evidence.activeFile) {
    const expected = args.snapshot.files[args.evidence.operationIndex]
    const activePath = join(args.root, ...args.evidence.activeFile.path.split('/'))
    const activeEntry = await lstat(activePath)
    const withoutActive = {
      ...observed,
      files: observed.files.filter((file) => file.path !== args.evidence.activeFile?.path)
    }
    if (
      !expected ||
      expected.path !== args.evidence.activeFile.path ||
      !activeEntry.isFile() ||
      activeEntry.isSymbolicLink() ||
      skillPhysicalIdentity(activePath, await stat(activePath)) !==
        args.evidence.activeFile.physicalIdentity ||
      observed.files.length !== withoutActive.files.length + 1 ||
      !matchesPrefix(withoutActive, args.snapshot, args.evidence.operationIndex)
    ) {
      throw new Error('skill-transaction-package-build-changed')
    }
    const activeObserved = observed.files.find(
      (file) => file.path === args.evidence.activeFile?.path
    )
    if (
      !activeObserved ||
      (args.evidence.activeFile.contentState === 'written' &&
        !matchesFileIdentity({ ...activeObserved, executable: expected.executable }, expected)) ||
      (args.evidence.activeFile.contentState === 'ready' &&
        !matchesFileIdentity(activeObserved, expected))
    ) {
      throw new Error('skill-transaction-package-build-changed')
    }
    await assertDirectoryShape(args.root, [...expectedPaths, expected.path])
    return
  }
  if (!matchesPrefix(observed, args.snapshot, args.evidence.operationIndex)) {
    throw new Error('skill-transaction-package-build-changed')
  }
  await assertDirectoryShape(
    args.root,
    args.evidence.pendingPath ? [...expectedPaths, args.evidence.pendingPath] : expectedPaths
  )
}

function renderedBytes(source: Buffer, expected: SkillBundleFileIdentity, crlf: boolean): Buffer {
  if (expected.classification !== 'text' || expected.executable || !crlf) {
    return source
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(source)
  return Buffer.from(text.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'), 'utf8')
}

export async function buildSkillTransactionPackage(args: {
  root: string
  sourceRoot: string
  snapshot: SkillReleasedSnapshot
  crlf: boolean
  assertSourceAuthority: () => Promise<void>
  journal: (evidence: SkillTransactionPackageBuildEvidence) => Promise<void>
  assertBoundary: (evidence: SkillTransactionPackageBuildEvidence) => Promise<void>
  runtime?: SkillTransactionPackageBuildRuntime
}): Promise<SkillTransactionPackageBuildEvidence> {
  await args.assertSourceAuthority()
  await (args.runtime?.createRoot ?? ((path) => mkdir(path)))(args.root)
  const rootEntry = await lstat(args.root)
  let evidence: SkillTransactionPackageBuildEvidence = {
    state: 'creating',
    physicalIdentity: skillPhysicalIdentity(args.root, rootEntry),
    operationIndex: 0,
    pendingPath: null,
    activeFile: null
  }
  await args.journal(evidence)
  for (const [operationIndex, expected] of args.snapshot.files.entries()) {
    evidence = { ...evidence, operationIndex, pendingPath: expected.path, activeFile: null }
    await args.journal(evidence)
    await args.assertBoundary(evidence)
    const destination = join(args.root, ...expected.path.split('/'))
    await (args.runtime?.createParent ?? ((path) => mkdir(path, { recursive: true })))(
      dirname(destination)
    )
    await args.assertBoundary(evidence)
    const mode = expected.executable ? 0o755 : 0o644
    const handle = await (
      args.runtime?.openFile ?? ((path, fileMode) => open(path, 'wx', fileMode))
    )(destination, mode)
    const activeFileIdentity = skillPhysicalIdentity(destination, await handle.stat())
    evidence = {
      ...evidence,
      operationIndex,
      pendingPath: null,
      activeFile: {
        path: expected.path,
        physicalIdentity: activeFileIdentity,
        contentState: 'created'
      }
    }
    let completed = false
    try {
      await args.journal(evidence)
      await args.assertSourceAuthority()
      const bytes = renderedBytes(
        await (args.runtime?.readSource ?? readFile)(
          join(args.sourceRoot, ...expected.path.split('/'))
        ),
        expected,
        args.crlf
      )
      const observedSource = describeObservedSkillFile(expected.path, bytes, expected.executable)
      if (!matchesFileIdentity(observedSource, expected)) {
        throw new Error('skill-transaction-package-source-changed')
      }
      await args.assertSourceAuthority()
      await args.assertBoundary(evidence)
      await (args.runtime?.writeBytes ?? ((target, value) => target.writeFile(value)))(
        handle,
        bytes
      )
      evidence = {
        ...evidence,
        activeFile: {
          path: expected.path,
          physicalIdentity: activeFileIdentity,
          contentState: 'written'
        }
      }
      await args.assertBoundary(evidence)
      await args.journal(evidence)
      if (process.platform !== 'win32') {
        await args.assertBoundary(evidence)
        await (args.runtime?.chmodFile ?? ((target, fileMode) => target.chmod(fileMode)))(
          handle,
          mode
        )
      }
      evidence = {
        ...evidence,
        activeFile: {
          path: expected.path,
          physicalIdentity: activeFileIdentity,
          contentState: 'ready'
        }
      }
      await args.assertBoundary(evidence)
      await args.journal(evidence)
      await args.assertBoundary(evidence)
      await (args.runtime?.syncFile ?? ((target) => target.sync()))(handle)
      await args.assertBoundary(evidence)
      completed = true
    } finally {
      const closing = handle.close()
      await (completed ? closing : closing.catch(() => undefined))
    }
    evidence = {
      ...evidence,
      operationIndex: operationIndex + 1,
      pendingPath: null,
      activeFile: null
    }
    await args.assertBoundary(evidence)
    await args.journal(evidence)
  }
  evidence = { ...evidence, state: 'ready' }
  await args.assertBoundary(evidence)
  await args.journal(evidence)
  return evidence
}

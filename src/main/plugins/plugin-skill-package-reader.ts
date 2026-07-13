import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open, readdir } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import { pluginPathSegmentError } from '../../shared/plugins/plugin-path-safety'
import { resolveContainedPluginDirectory } from './plugin-artifact-validation'

const SKILL_ENTRY_LIMIT = 200
const SKILL_DIRECTORY_DEPTH_LIMIT = 16
const SKILL_PACKAGE_MAX_BYTES = 10 * 1024 * 1024
const SKILL_CONTRIBUTION_MAX_BYTES = 50 * 1024 * 1024
const SKILL_PACKAGES_PER_CONTRIBUTION_LIMIT = 128
const SKILL_MARKDOWN_MAX_BYTES = 256 * 1024

export type PluginSkillPackageFile = {
  relativePath: string
  content: Buffer
}

export type PluginSkillPackage = {
  skillName: string
  files: PluginSkillPackageFile[]
  contentHash: string
}

async function readRegularFile(path: string, maxBytes: number): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const fileStat = await handle.stat()
    if (!fileStat.isFile()) {
      throw new Error(`${path} is not a regular file`)
    }
    if (fileStat.size > maxBytes) {
      throw new Error(`${path} exceeds the ${maxBytes}-byte limit`)
    }
    const content = Buffer.alloc(fileStat.size)
    let offset = 0
    while (offset < content.byteLength) {
      const { bytesRead } = await handle.read(content, offset, content.byteLength - offset, offset)
      if (bytesRead === 0) {
        throw new Error(`${path} changed while the skill package was read`)
      }
      offset += bytesRead
    }
    const extra = Buffer.allocUnsafe(1)
    if ((await handle.read(extra, 0, 1, offset)).bytesRead !== 0) {
      throw new Error(`${path} changed while the skill package was read`)
    }
    return content
  } finally {
    await handle.close()
  }
}

async function collectPackageFiles(packageRoot: string): Promise<PluginSkillPackageFile[]> {
  const files: PluginSkillPackageFile[] = []
  let totalBytes = 0
  let entriesVisited = 0
  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > SKILL_DIRECTORY_DEPTH_LIMIT) {
      throw new Error(
        `skill package exceeds the ${SKILL_DIRECTORY_DEPTH_LIMIT}-directory depth limit`
      )
    }
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
    for (const entry of entries) {
      entriesVisited += 1
      if (entriesVisited > SKILL_ENTRY_LIMIT) {
        throw new Error(`skill package exceeds the ${SKILL_ENTRY_LIMIT}-entry limit`)
      }
      const segmentError = pluginPathSegmentError(entry.name)
      if (segmentError) {
        throw new Error(`unsafe skill path segment "${entry.name}": ${segmentError}`)
      }
      const entryPath = join(directory, entry.name)
      if (directory === packageRoot && entry.name === '.orca-plugin-owner.json') {
        throw new Error('skill package cannot replace Orca ownership metadata')
      }
      if (entry.isSymbolicLink()) {
        throw new Error(
          `skill package cannot contain symlinks: ${relative(packageRoot, entryPath)}`
        )
      }
      if (entry.isDirectory()) {
        await visit(entryPath, depth + 1)
        continue
      }
      if (!entry.isFile()) {
        throw new Error(
          `skill package contains an unsupported entry: ${relative(packageRoot, entryPath)}`
        )
      }
      const remainingBytes = SKILL_PACKAGE_MAX_BYTES - totalBytes
      const content = await readRegularFile(entryPath, remainingBytes)
      totalBytes += content.byteLength
      files.push({ relativePath: relative(packageRoot, entryPath), content })
    }
  }
  await visit(packageRoot, 0)
  const skillMarkdown = files.find((file) => file.relativePath === 'SKILL.md')
  if (!skillMarkdown) {
    throw new Error(`skill package ${basename(packageRoot)} is missing SKILL.md`)
  }
  if (skillMarkdown.content.byteLength > SKILL_MARKDOWN_MAX_BYTES) {
    throw new Error(`SKILL.md exceeds the ${SKILL_MARKDOWN_MAX_BYTES}-byte limit`)
  }
  return files
}

function hashSkillFiles(files: readonly PluginSkillPackageFile[]): string {
  const hash = createHash('sha256').update('orca-plugin-skill-v1\0')
  for (const file of files) {
    const pathBytes = Buffer.from(file.relativePath.replaceAll('\\', '/'), 'utf8')
    const pathLength = Buffer.allocUnsafe(4)
    pathLength.writeUInt32BE(pathBytes.byteLength)
    const contentLength = Buffer.allocUnsafe(8)
    contentLength.writeBigUInt64BE(BigInt(file.content.byteLength))
    hash.update(pathLength).update(pathBytes).update(contentLength).update(file.content)
  }
  return hash.digest('hex')
}

export async function readPluginSkillPackages(
  pluginRoot: string,
  contributionPath: string
): Promise<PluginSkillPackage[]> {
  const contributionRoot = await resolveContainedPluginDirectory(pluginRoot, contributionPath)
  const rootEntries = await readdir(contributionRoot, { withFileTypes: true })
  rootEntries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
  const containsSkillMarkdown = rootEntries.some(
    (entry) => entry.name === 'SKILL.md' && entry.isFile()
  )
  const packageRoots = containsSkillMarkdown
    ? [contributionRoot]
    : rootEntries
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(contributionRoot, entry.name))
  if (packageRoots.length === 0) {
    throw new Error(`skill contribution ${contributionPath} contains no skill packages`)
  }
  if (packageRoots.length > SKILL_PACKAGES_PER_CONTRIBUTION_LIMIT) {
    throw new Error(
      `skill contribution exceeds the ${SKILL_PACKAGES_PER_CONTRIBUTION_LIMIT}-package limit`
    )
  }
  const packages: PluginSkillPackage[] = []
  let totalBytes = 0
  for (const packageRoot of packageRoots) {
    const files = await collectPackageFiles(packageRoot)
    totalBytes += files.reduce((total, file) => total + file.content.byteLength, 0)
    if (totalBytes > SKILL_CONTRIBUTION_MAX_BYTES) {
      throw new Error(`skill contribution exceeds the ${SKILL_CONTRIBUTION_MAX_BYTES}-byte limit`)
    }
    packages.push({ skillName: basename(packageRoot), files, contentHash: hashSkillFiles(files) })
  }
  return packages
}

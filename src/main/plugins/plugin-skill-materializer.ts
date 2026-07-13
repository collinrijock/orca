import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import type {
  PluginSkillMappingTarget,
  PluginSkillProvider,
  PluginSkillRegistration
} from '../../shared/plugins/plugin-skill-store'
import type { PluginSkillPackage } from './plugin-skill-package-reader'

const ownershipSchema = z
  .object({
    schemaVersion: z.literal(1),
    pluginKey: z.string(),
    contributionPath: z.string(),
    skillName: z.string(),
    contentHash: z.string().regex(/^[0-9a-f]{64}$/)
  })
  .strict()

type SkillOwnership = z.infer<typeof ownershipSchema>
type MaterializationIndexEntry = SkillOwnership & { path: string }

const materializationIndexSchema = z
  .object({
    schemaVersion: z.literal(1),
    entries: z.array(ownershipSchema.extend({ path: z.string() }))
  })
  .strict()

export type PluginSkillMaterializationSpec = {
  pluginKey: string
  contributionPath: string
  providers: PluginSkillProvider[]
  skill: PluginSkillPackage
  targets: PluginSkillMappingTarget[]
}

export type PluginSkillMaterializationResult = {
  registrations: PluginSkillRegistration[]
  errors: Map<string, string>
}

function providerRoot(
  homeDir: string,
  target: PluginSkillMappingTarget,
  provider: PluginSkillProvider
): string {
  if (target.scope === 'repository') {
    return provider === 'claude'
      ? join(target.repositoryPath!, '.claude', 'skills')
      : join(target.repositoryPath!, '.agents', 'skills')
  }
  if (provider === 'codex') {
    return join(homeDir, '.codex', 'skills')
  }
  if (provider === 'claude') {
    return join(homeDir, '.claude', 'skills')
  }
  return join(homeDir, '.agents', 'skills')
}

function destinationName(spec: PluginSkillMaterializationSpec): string {
  const readableName = spec.skill.skillName
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  const identity = createHash('sha256')
    .update(`${spec.pluginKey}\0${spec.contributionPath}\0${spec.skill.skillName}`)
    .digest('hex')
    .slice(0, 16)
  return `orca-${readableName || 'skill'}-${identity}`
}

function ownershipFor(spec: PluginSkillMaterializationSpec): SkillOwnership {
  return {
    schemaVersion: 1,
    pluginKey: spec.pluginKey,
    contributionPath: spec.contributionPath,
    skillName: spec.skill.skillName,
    contentHash: spec.skill.contentHash
  }
}

function sameIdentity(left: SkillOwnership, right: SkillOwnership): boolean {
  return (
    left.pluginKey === right.pluginKey &&
    left.contributionPath === right.contributionPath &&
    left.skillName === right.skillName
  )
}

function sameIndex(
  left: readonly MaterializationIndexEntry[],
  right: readonly MaterializationIndexEntry[]
): boolean {
  return (
    left.length === right.length &&
    left.every((entry, index) => {
      const candidate = right[index]
      return (
        candidate !== undefined &&
        entry.path === candidate.path &&
        entry.contentHash === candidate.contentHash &&
        sameIdentity(entry, candidate)
      )
    })
  )
}

async function readOwnership(path: string): Promise<SkillOwnership | null> {
  try {
    return ownershipSchema.parse(
      JSON.parse(await readFile(join(path, '.orca-plugin-owner.json'), 'utf8'))
    )
  } catch {
    return null
  }
}

export class PluginSkillMaterializer {
  private readonly indexPath: string

  constructor(
    private readonly homeDir: string,
    pluginsDataDir: string
  ) {
    this.indexPath = join(pluginsDataDir, 'skill-materializations.json')
  }

  async reconcile(
    specs: readonly PluginSkillMaterializationSpec[]
  ): Promise<PluginSkillMaterializationResult> {
    const previous = await this.readIndex()
    const desiredPaths = new Set<string>()
    const nextEntries: MaterializationIndexEntry[] = []
    const registrations: PluginSkillRegistration[] = []
    const errors = new Map<string, string>()

    for (const spec of specs) {
      const paths = new Set<string>()
      for (const target of spec.targets) {
        for (const provider of target.providers) {
          const path = join(providerRoot(this.homeDir, target, provider), destinationName(spec))
          if (paths.has(path)) {
            continue
          }
          paths.add(path)
          desiredPaths.add(path)
          const ownership = ownershipFor(spec)
          try {
            await this.materialize(path, ownership, spec.skill)
            nextEntries.push({ ...ownership, path })
          } catch (error) {
            errors.set(spec.pluginKey, error instanceof Error ? error.message : String(error))
            await this.removeIfOwned({ ...ownership, path })
          }
        }
      }
      if (!errors.has(spec.pluginKey)) {
        registrations.push({
          pluginKey: spec.pluginKey,
          contributionPath: spec.contributionPath,
          skillName: spec.skill.skillName,
          providers: spec.providers,
          materializedPaths: [...paths]
        })
      }
    }

    for (const stale of previous) {
      if (!desiredPaths.has(stale.path)) {
        await this.removeIfOwned(stale)
      }
    }
    const failedPlugins = new Set(errors.keys())
    const retainedEntries = nextEntries.filter((entry) => !failedPlugins.has(entry.pluginKey))
    await Promise.all(
      nextEntries
        .filter((entry) => failedPlugins.has(entry.pluginKey))
        .map((entry) => this.removeIfOwned(entry))
    )
    if (!sameIndex(previous, retainedEntries)) {
      await this.writeIndex(retainedEntries)
    }
    return {
      registrations: registrations.filter(
        (registration) => !failedPlugins.has(registration.pluginKey)
      ),
      errors
    }
  }

  private async materialize(
    destination: string,
    ownership: SkillOwnership,
    skill: PluginSkillPackage
  ): Promise<void> {
    const current = await readOwnership(destination)
    if (
      current &&
      sameIdentity(current, ownership) &&
      current.contentHash === ownership.contentHash
    ) {
      return
    }
    if (!current && (await this.pathExists(destination))) {
      throw new Error(`skill destination collision at ${destination}`)
    }
    if (current && !sameIdentity(current, ownership)) {
      throw new Error(`skill destination is owned by another plugin at ${destination}`)
    }

    const parent = dirname(destination)
    await mkdir(parent, { recursive: true })
    const staging = join(parent, `.orca-plugin-skill-${randomUUID()}.tmp`)
    const backup = join(parent, `.orca-plugin-skill-${randomUUID()}.bak`)
    let removeBackup = false
    try {
      await mkdir(staging)
      for (const file of skill.files) {
        const target = join(staging, file.relativePath)
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, file.content)
      }
      await writeFile(join(staging, '.orca-plugin-owner.json'), `${JSON.stringify(ownership)}\n`)
      if (current) {
        await rename(destination, backup)
      }
      try {
        await rename(staging, destination)
      } catch (error) {
        if (current) {
          try {
            await rename(backup, destination)
          } catch (restoreError) {
            throw new AggregateError(
              [error, restoreError],
              `skill update failed and its recovery copy remains at ${backup}`
            )
          }
        }
        throw error
      }
      removeBackup = true
      await rm(backup, { recursive: true, force: true })
    } finally {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined)
      if (removeBackup) {
        await rm(backup, { recursive: true, force: true }).catch(() => undefined)
      }
    }
  }

  private async removeIfOwned(entry: MaterializationIndexEntry): Promise<void> {
    const current = await readOwnership(entry.path)
    if (current && sameIdentity(current, entry)) {
      await rm(entry.path, { recursive: true, force: true })
    }
  }

  private async pathExists(path: string): Promise<boolean> {
    try {
      await stat(path)
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false
      }
      throw error
    }
  }

  private async readIndex(): Promise<MaterializationIndexEntry[]> {
    try {
      return materializationIndexSchema.parse(JSON.parse(await readFile(this.indexPath, 'utf8')))
        .entries
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return []
      }
      throw new Error(
        `plugin skill ownership index is invalid: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  private async writeIndex(entries: readonly MaterializationIndexEntry[]): Promise<void> {
    await mkdir(dirname(this.indexPath), { recursive: true })
    const temporaryPath = `${this.indexPath}.${randomUUID()}.tmp`
    try {
      await writeFile(
        temporaryPath,
        `${JSON.stringify({ schemaVersion: 1, entries }, null, 2)}\n`,
        'utf8'
      )
      await rename(temporaryPath, this.indexPath)
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined)
    }
  }
}

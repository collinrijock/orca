import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { z } from 'zod'
import {
  pluginSkillContributionMappingSchema,
  type PluginSkillContributionMapping,
  type PluginSkillMappingTarget,
  type PluginSkillProvider
} from '../../shared/plugins/plugin-skill-store'

const mappingFileSchema = z
  .object({ schemaVersion: z.literal(1), mappings: z.array(pluginSkillContributionMappingSchema) })
  .strict()

export class PluginSkillMappingStore {
  private readonly filePath: string
  private mappings: PluginSkillContributionMapping[] | null = null
  private writeChain: Promise<void> = Promise.resolve()

  constructor(pluginsDataDir: string) {
    this.filePath = join(pluginsDataDir, 'skill-mappings.json')
  }

  async list(): Promise<readonly PluginSkillContributionMapping[]> {
    await this.load()
    return this.mappings!
  }

  async targetsFor(
    pluginKey: string,
    contributionPath: string,
    defaultProviders: readonly PluginSkillProvider[]
  ): Promise<PluginSkillMappingTarget[]> {
    await this.load()
    const mapping = this.mappings!.find(
      (candidate) =>
        candidate.pluginKey === pluginKey && candidate.contributionPath === contributionPath
    )
    return mapping ? mapping.targets : [{ scope: 'user', providers: [...defaultProviders] }]
  }

  async set(mapping: PluginSkillContributionMapping): Promise<void> {
    const parsed = pluginSkillContributionMappingSchema.parse(mapping)
    for (const target of parsed.targets) {
      if (target.scope === 'repository' && !isAbsolute(target.repositoryPath!)) {
        throw new Error('repository skill target must use an absolute local path')
      }
    }
    const update = this.writeChain
      .catch(() => undefined)
      .then(async () => {
        await this.load()
        const next = this.mappings!.filter(
          (candidate) =>
            candidate.pluginKey !== parsed.pluginKey ||
            candidate.contributionPath !== parsed.contributionPath
        )
        next.push(parsed)
        next.sort((left, right) =>
          `${left.pluginKey}\0${left.contributionPath}`.localeCompare(
            `${right.pluginKey}\0${right.contributionPath}`
          )
        )
        await this.persist(next)
        this.mappings = next
      })
    this.writeChain = update
    await update
  }

  private async load(): Promise<void> {
    if (this.mappings !== null) {
      return
    }
    try {
      const parsed = mappingFileSchema.parse(JSON.parse(await readFile(this.filePath, 'utf8')))
      this.mappings = parsed.mappings
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error(
          `plugin skill mappings are invalid: ${error instanceof Error ? error.message : String(error)}`
        )
      }
      this.mappings = []
    }
  }

  private async persist(mappings: readonly PluginSkillContributionMapping[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`
    try {
      await writeFile(
        temporaryPath,
        `${JSON.stringify({ schemaVersion: 1, mappings }, null, 2)}\n`,
        'utf8'
      )
      await rename(temporaryPath, this.filePath)
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined)
    }
  }
}

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { pluginManifestSchema, type PluginManifest } from '../../shared/plugins/plugin-manifest'
import { isSafePluginRelativePath } from '../../shared/plugins/plugin-path-safety'
import { readContainedPluginArtifactText } from './plugin-artifact-validation'
import { readPluginSkillPackages } from './plugin-skill-package-reader'

const IMPORT_MARKETPLACE_MAX_BYTES = 2 * 1024 * 1024
const IMPORT_PLUGIN_LIMIT = 256

const importedEntrySchema = z
  .object({
    name: z.string().min(1).max(256),
    source: z.string().min(1).max(1024),
    description: z.string().max(4096).optional(),
    version: z.string().max(128).optional()
  })
  .passthrough()

const importedMarketplaceSchema = z
  .object({
    name: z.string().min(1).max(256).optional(),
    owner: z
      .union([
        z.string().min(1).max(256),
        z.object({ name: z.string().min(1).max(256) }).passthrough()
      ])
      .optional(),
    plugins: z.array(importedEntrySchema).max(IMPORT_PLUGIN_LIMIT)
  })
  .passthrough()

export type ImportedAgentSkillPlugin = {
  sourceName: string
  rootDir: string
  manifest: PluginManifest
}

function portableSlug(value: string, fallback: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || fallback
}

function normalizeLocalSource(source: string): string {
  const normalized = source.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '')
  if (normalized === '' || normalized === '.') {
    return ''
  }
  if (!isSafePluginRelativePath(normalized)) {
    throw new Error(`agent plugin source must be a local path inside the marketplace: ${source}`)
  }
  return normalized
}

function generatedManifest(
  entry: z.infer<typeof importedEntrySchema>,
  ownerName: string,
  source: string
): PluginManifest {
  const publisher = `imported-${portableSlug(ownerName, 'agent-skills')}`
    .slice(0, 64)
    .replace(/-+$/, '')
  const sourceHash = createHash('sha256')
    .update(source || '.')
    .digest('hex')
    .slice(0, 8)
  const id = `${`skill-${portableSlug(entry.name, 'package')}`
    .slice(0, 55)
    .replace(/-+$/, '')}-${sourceHash}`
  const base = {
    manifestVersion: 1,
    id,
    publisher,
    name: entry.name,
    ...(entry.description ? { description: entry.description } : {}),
    engines: { orca: '>=1.0.0' },
    pluginApi: 1,
    contributes: { skills: [{ path: 'skills' }] },
    capabilities: []
  }
  const withVersion = pluginManifestSchema.safeParse({ ...base, version: entry.version ?? '0.0.0' })
  return withVersion.success
    ? withVersion.data
    : pluginManifestSchema.parse({ ...base, version: '0.0.0' })
}

async function pathExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false
    }
    throw error
  }
}

export async function importAgentSkillRepository(
  repositoryRoot: string,
  outputRoot: string
): Promise<ImportedAgentSkillPlugin[]> {
  const manifestCandidates = ['.claude-plugin/marketplace.json', 'marketplace.json']
  let raw: string | null = null
  for (const candidate of manifestCandidates) {
    try {
      raw = await readContainedPluginArtifactText(
        repositoryRoot,
        candidate,
        IMPORT_MARKETPLACE_MAX_BYTES
      )
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }
  }
  if (raw === null) {
    throw new Error('agent plugin repository has no marketplace.json')
  }
  const marketplace = importedMarketplaceSchema.parse(JSON.parse(raw))
  const ownerName =
    typeof marketplace.owner === 'string'
      ? marketplace.owner
      : (marketplace.owner?.name ?? marketplace.name ?? 'agent-skills')
  const imported: ImportedAgentSkillPlugin[] = []
  await mkdir(outputRoot, { recursive: true })
  for (const entry of marketplace.plugins) {
    const source = normalizeLocalSource(entry.source)
    const skillPath = source ? `${source}/skills` : 'skills'
    if (!(await pathExists(join(repositoryRoot, ...skillPath.split('/'))))) {
      continue
    }
    const packages = await readPluginSkillPackages(repositoryRoot, skillPath)
    const manifest = generatedManifest(entry, ownerName, source)
    const destination = join(outputRoot, `${manifest.publisher}.${manifest.id}`)
    const staging = join(outputRoot, `.orca-agent-skill-import-${randomUUID()}.tmp`)
    try {
      for (const skill of packages) {
        for (const file of skill.files) {
          const target = join(staging, 'skills', skill.skillName, file.relativePath)
          await mkdir(dirname(target), { recursive: true })
          await writeFile(target, file.content)
        }
      }
      await writeFile(join(staging, 'orca-plugin.json'), `${JSON.stringify(manifest, null, 2)}\n`)
      await rename(staging, destination)
      imported.push({ sourceName: entry.name, rootDir: destination, manifest })
    } finally {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined)
    }
  }
  return imported
}

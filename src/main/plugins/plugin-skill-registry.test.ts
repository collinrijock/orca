import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { fingerprintPluginConsent } from '../../shared/plugins/plugin-consent-fingerprint'
import { pluginManifestSchema } from '../../shared/plugins/plugin-manifest'
import { PluginContentVerifier } from './plugin-content-integrity'
import { discoverSkills } from '../skills/discovery'
import type { ValidDiscoveredPlugin } from './plugin-discovery'
import { PluginSkillRegistry } from './plugin-skill-registry'

const roots: string[] = []

async function tempRoot(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), label))
  roots.push(root)
  return root
}

async function pluginWithSkill(): Promise<ValidDiscoveredPlugin> {
  const rootDir = await tempRoot('orca-plugin-skill-registry-plugin-')
  await mkdir(join(rootDir, 'skills', 'review', 'references'), { recursive: true })
  await writeFile(join(rootDir, 'skills', 'review', 'SKILL.md'), '# Review\nReview changes.')
  await writeFile(join(rootDir, 'skills', 'review', 'references', 'checks.md'), 'Run tests.')
  const manifest = pluginManifestSchema.parse({
    manifestVersion: 1,
    id: 'skills',
    publisher: 'orca-samples',
    name: 'Skills',
    version: '1.0.0',
    engines: { orca: '>=1.0.0' },
    pluginApi: 1,
    contributes: { skills: [{ path: 'skills', providers: ['codex', 'claude'] }] },
    capabilities: []
  })
  return {
    pluginKey: 'orca-samples.skills',
    rootDir,
    manifest,
    consentFingerprint: fingerprintPluginConsent(manifest),
    contentHash: null,
    isDev: true
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('PluginSkillRegistry', () => {
  it('materializes approved contributions and removes them when disabled', async () => {
    const plugin = await pluginWithSkill()
    const data = await tempRoot('orca-plugin-skill-registry-data-')
    const home = await tempRoot('orca-plugin-skill-registry-home-')
    const registry = new PluginSkillRegistry(new PluginContentVerifier(), data, home)

    await registry.reconcile([plugin], () => true)

    expect(registry.error(plugin.pluginKey)).toBeNull()
    expect(registry.list()).toHaveLength(1)
    expect(registry.list()[0]?.providers).toEqual(['codex', 'claude'])
    const paths = registry.list()[0]!.materializedPaths
    expect(paths).toHaveLength(2)
    await expect(readFile(join(paths[0]!, 'SKILL.md'), 'utf8')).resolves.toContain('# Review')
    const discovered = await discoverSkills({ homeDir: home, cwd: home })
    const materializedSkills = discovered.skills.filter((skill) =>
      paths.includes(skill.directoryPath)
    )
    expect(materializedSkills).toHaveLength(2)
    expect(materializedSkills.every((skill) => skill.sourceKind === 'plugin')).toBe(true)

    await registry.reconcile([plugin], () => false)
    expect(registry.list()).toEqual([])
    await expect(stat(paths[0]!)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(paths[1]!)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('honors a repository-only contribution mapping', async () => {
    const plugin = await pluginWithSkill()
    const data = await tempRoot('orca-plugin-skill-registry-data-')
    const home = await tempRoot('orca-plugin-skill-registry-home-')
    const repository = await tempRoot('orca-plugin-skill-registry-repo-')
    const registry = new PluginSkillRegistry(new PluginContentVerifier(), data, home)
    await registry.setMapping({
      pluginKey: plugin.pluginKey,
      contributionPath: 'skills',
      targets: [{ scope: 'repository', repositoryPath: repository, providers: ['claude'] }]
    })

    await registry.reconcile([plugin], () => true)

    expect(registry.list()[0]?.materializedPaths).toEqual([
      expect.stringContaining(join(repository, '.claude', 'skills'))
    ])
  })

  it('keeps disabled contributions configurable without materializing files', async () => {
    const plugin = await pluginWithSkill()
    const data = await tempRoot('orca-plugin-skill-registry-data-')
    const home = await tempRoot('orca-plugin-skill-registry-home-')
    const registry = new PluginSkillRegistry(new PluginContentVerifier(), data, home)
    await registry.setMapping({
      pluginKey: plugin.pluginKey,
      contributionPath: 'skills',
      targets: []
    })

    await registry.reconcile([plugin], () => true)

    expect(registry.list()).toEqual([
      expect.objectContaining({
        providers: ['codex', 'claude'],
        materializedPaths: []
      })
    ])
  })

  it('fails closed when a contributed skill package is invalid', async () => {
    const plugin = await pluginWithSkill()
    const data = await tempRoot('orca-plugin-skill-registry-data-')
    const home = await tempRoot('orca-plugin-skill-registry-home-')
    const registry = new PluginSkillRegistry(new PluginContentVerifier(), data, home)
    await rm(join(plugin.rootDir, 'skills', 'review', 'SKILL.md'))

    await registry.reconcile([plugin], () => true)

    expect(registry.list()).toEqual([])
    expect(registry.error(plugin.pluginKey)).toContain('missing SKILL.md')
  })
})

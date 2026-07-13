import { mkdtemp, readFile, rm, stat, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { PluginSkillPackage } from './plugin-skill-package-reader'
import {
  PluginSkillMaterializer,
  type PluginSkillMaterializationSpec
} from './plugin-skill-materializer'

const roots: string[] = []

async function tempRoot(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), label))
  roots.push(root)
  return root
}

function skill(content: string, contentHash = 'a'.repeat(64)): PluginSkillPackage {
  return {
    skillName: 'review',
    contentHash,
    files: [
      { relativePath: 'SKILL.md', content: Buffer.from(content) },
      { relativePath: join('references', 'checks.md'), content: Buffer.from('Run tests.') }
    ]
  }
}

function spec(skillPackage: PluginSkillPackage): PluginSkillMaterializationSpec {
  return {
    pluginKey: 'orca-samples.skills',
    contributionPath: 'skills',
    providers: ['codex', 'agent-skills'],
    skill: skillPackage,
    targets: [{ scope: 'user', providers: ['codex', 'agent-skills'] }]
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('PluginSkillMaterializer', () => {
  it('atomically installs, updates, and removes owned user skills', async () => {
    const home = await tempRoot('orca-plugin-skill-home-')
    const data = await tempRoot('orca-plugin-skill-data-')
    const materializer = new PluginSkillMaterializer(home, data)

    const installed = await materializer.reconcile([spec(skill('# Review v1'))])
    expect(installed.errors.size).toBe(0)
    expect(installed.registrations[0]?.materializedPaths).toHaveLength(2)
    const paths = installed.registrations[0]!.materializedPaths
    await expect(readFile(join(paths[0]!, 'SKILL.md'), 'utf8')).resolves.toBe('# Review v1')
    await expect(readFile(join(paths[1]!, 'references', 'checks.md'), 'utf8')).resolves.toBe(
      'Run tests.'
    )

    const updated = await materializer.reconcile([spec(skill('# Review v2', 'b'.repeat(64)))])
    expect(updated.errors.size).toBe(0)
    await expect(readFile(join(paths[0]!, 'SKILL.md'), 'utf8')).resolves.toBe('# Review v2')

    await materializer.reconcile([])
    await expect(stat(paths[0]!)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(paths[1]!)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('deduplicates shared repository roots across compatible providers', async () => {
    const home = await tempRoot('orca-plugin-skill-home-')
    const data = await tempRoot('orca-plugin-skill-data-')
    const repository = await tempRoot('orca-plugin-skill-repo-')
    const materializer = new PluginSkillMaterializer(home, data)
    const repositorySpec: PluginSkillMaterializationSpec = {
      ...spec(skill('# Review')),
      targets: [
        { scope: 'repository', repositoryPath: repository, providers: ['codex', 'agent-skills'] },
        { scope: 'repository', repositoryPath: repository, providers: ['claude'] }
      ]
    }

    const result = await materializer.reconcile([repositorySpec])

    expect(result.registrations[0]?.materializedPaths).toHaveLength(2)
    expect(result.registrations[0]?.materializedPaths).toEqual(
      expect.arrayContaining([
        expect.stringContaining(join('.agents', 'skills')),
        expect.stringContaining(join('.claude', 'skills'))
      ])
    )
  })

  it('does not overwrite or remove a destination whose ownership marker was removed', async () => {
    const home = await tempRoot('orca-plugin-skill-home-')
    const data = await tempRoot('orca-plugin-skill-data-')
    const materializer = new PluginSkillMaterializer(home, data)
    const first = await materializer.reconcile([spec(skill('# Review v1'))])
    const destination = first.registrations[0]!.materializedPaths[0]!
    await unlink(join(destination, '.orca-plugin-owner.json'))

    const result = await materializer.reconcile([spec(skill('# Review v2', 'b'.repeat(64)))])

    expect(result.errors.get('orca-samples.skills')).toContain('collision')
    await expect(readFile(join(destination, 'SKILL.md'), 'utf8')).resolves.toBe('# Review v1')
  })
})

import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { pluginManifestSchema } from '../../shared/plugins/plugin-manifest'
import { importAgentSkillRepository } from './agent-skill-repository-import'

const roots: string[] = []

async function tempRoot(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), label))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('agent skill repository importer', () => {
  it('creates inert Orca skill plugins from local marketplace entries', async () => {
    const repository = await tempRoot('orca-agent-skill-repo-')
    const output = await tempRoot('orca-agent-skill-output-')
    await mkdir(join(repository, '.claude-plugin'))
    await mkdir(join(repository, 'plugins', 'review', 'skills', 'review'), { recursive: true })
    await writeFile(
      join(repository, '.claude-plugin', 'marketplace.json'),
      JSON.stringify({
        name: 'Team skills',
        owner: { name: 'Acme Corp' },
        plugins: [
          {
            name: 'Review tools',
            source: './plugins/review',
            description: 'Review changes consistently.',
            version: '1.2.0'
          }
        ]
      })
    )
    await writeFile(
      join(repository, 'plugins', 'review', 'skills', 'review', 'SKILL.md'),
      '# Review'
    )

    const [imported] = await importAgentSkillRepository(repository, output)

    expect(imported?.manifest).toMatchObject({
      publisher: 'imported-acme-corp',
      name: 'Review tools',
      version: '1.2.0',
      capabilities: [],
      contributes: { skills: [{ path: 'skills' }] }
    })
    const manifest = pluginManifestSchema.parse(
      JSON.parse(await readFile(join(imported!.rootDir, 'orca-plugin.json'), 'utf8'))
    )
    expect(manifest.main).toBeUndefined()
    await expect(
      readFile(join(imported!.rootDir, 'skills', 'review', 'SKILL.md'), 'utf8')
    ).resolves.toBe('# Review')
  })

  it('rejects marketplace sources that escape the checked-out repository', async () => {
    const repository = await tempRoot('orca-agent-skill-repo-')
    const output = await tempRoot('orca-agent-skill-output-')
    await writeFile(
      join(repository, 'marketplace.json'),
      JSON.stringify({ plugins: [{ name: 'Escape', source: '../outside' }] })
    )

    await expect(importAgentSkillRepository(repository, output)).rejects.toThrow(
      /local path inside the marketplace/
    )
  })
})

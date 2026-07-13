import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PluginSkillMappingStore } from './plugin-skill-mapping-store'

const roots: string[] = []

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'orca-plugin-skill-mappings-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('PluginSkillMappingStore', () => {
  it('defaults new contributions to the declared user-level providers', async () => {
    const store = new PluginSkillMappingStore(await tempRoot())

    await expect(
      store.targetsFor('orca-samples.skills', 'skills', ['codex', 'claude'])
    ).resolves.toEqual([{ scope: 'user', providers: ['codex', 'claude'] }])
  })

  it('persists per-repository mappings and explicit materialization opt-out', async () => {
    const data = await tempRoot()
    const repository = await tempRoot()
    const store = new PluginSkillMappingStore(data)
    await store.set({
      pluginKey: 'orca-samples.skills',
      contributionPath: 'skills',
      targets: [{ scope: 'repository', repositoryPath: repository, providers: ['claude'] }]
    })

    const reloaded = new PluginSkillMappingStore(data)
    await expect(reloaded.targetsFor('orca-samples.skills', 'skills', ['codex'])).resolves.toEqual([
      { scope: 'repository', repositoryPath: repository, providers: ['claude'] }
    ])

    await reloaded.set({
      pluginKey: 'orca-samples.skills',
      contributionPath: 'skills',
      targets: []
    })
    await expect(reloaded.targetsFor('orca-samples.skills', 'skills', ['codex'])).resolves.toEqual(
      []
    )
  })

  it('rejects relative repository targets', async () => {
    const store = new PluginSkillMappingStore(await tempRoot())

    await expect(
      store.set({
        pluginKey: 'orca-samples.skills',
        contributionPath: 'skills',
        targets: [{ scope: 'repository', repositoryPath: 'relative/repo', providers: ['codex'] }]
      })
    ).rejects.toThrow(/absolute local path/)
  })

  it('serializes concurrent mapping updates without dropping either contribution', async () => {
    const data = await tempRoot()
    const store = new PluginSkillMappingStore(data)

    await Promise.all([
      store.set({
        pluginKey: 'orca-samples.skills',
        contributionPath: 'skills/one',
        targets: [{ scope: 'user', providers: ['codex'] }]
      }),
      store.set({
        pluginKey: 'orca-samples.skills',
        contributionPath: 'skills/two',
        targets: [{ scope: 'user', providers: ['claude'] }]
      })
    ])

    await expect(new PluginSkillMappingStore(data).list()).resolves.toHaveLength(2)
  })
})

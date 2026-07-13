import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readPluginSkillPackages } from './plugin-skill-package-reader'

const roots: string[] = []

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'orca-plugin-skill-package-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('plugin skill package reader', () => {
  it('loads multiple bounded packages with deterministic content hashes', async () => {
    const root = await tempRoot()
    await mkdir(join(root, 'skills', 'review', 'references'), { recursive: true })
    await mkdir(join(root, 'skills', 'ship'), { recursive: true })
    await writeFile(join(root, 'skills', 'review', 'SKILL.md'), '# Review')
    await writeFile(join(root, 'skills', 'review', 'references', 'checks.md'), 'Check types.')
    await writeFile(join(root, 'skills', 'ship', 'SKILL.md'), '# Ship')

    const first = await readPluginSkillPackages(root, 'skills')
    const second = await readPluginSkillPackages(root, 'skills')

    expect(first.map((skill) => skill.skillName)).toEqual(['review', 'ship'])
    expect(first[0]?.files.map((file) => file.relativePath)).toEqual([
      'SKILL.md',
      join('references', 'checks.md')
    ])
    expect(first.map((skill) => skill.contentHash)).toEqual(
      second.map((skill) => skill.contentHash)
    )
  })

  it('accepts a contribution that directly names one skill directory', async () => {
    const root = await tempRoot()
    await mkdir(join(root, 'skill'))
    await writeFile(join(root, 'skill', 'SKILL.md'), '# Direct')

    await expect(readPluginSkillPackages(root, 'skill')).resolves.toMatchObject([
      { skillName: 'skill' }
    ])
  })

  it('rejects missing skill manifests and linked content', async () => {
    const root = await tempRoot()
    const outside = await tempRoot()
    await mkdir(join(root, 'skills', 'invalid'), { recursive: true })
    await writeFile(join(outside, 'secret.md'), 'outside')
    await symlink(join(outside, 'secret.md'), join(root, 'skills', 'invalid', 'secret.md'))

    await expect(readPluginSkillPackages(root, 'skills')).rejects.toThrow(/symlink/i)
  })

  it('reserves the materialized ownership filename for Orca', async () => {
    const root = await tempRoot()
    await mkdir(join(root, 'skill'))
    await writeFile(join(root, 'skill', 'SKILL.md'), '# Skill')
    await writeFile(join(root, 'skill', '.orca-plugin-owner.json'), '{}')

    await expect(readPluginSkillPackages(root, 'skill')).rejects.toThrow(/ownership metadata/)
  })
})

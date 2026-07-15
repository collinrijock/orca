import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { scanKnownPluginSkillCandidates } from './skill-plugin-cache-scan'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((root) => rm(root, { recursive: true })))
})

describe('plugin skill candidate scan', () => {
  it('stops at the package candidate budget and marks the scan incomplete', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-plugin-skill-scan-'))
    temporaryDirectories.push(root)
    await Promise.all(
      ['one', 'two'].map((vendor) => mkdir(join(root, vendor, 'orca-cli'), { recursive: true }))
    )

    const result = await scanKnownPluginSkillCandidates(root, new Set(['orca-cli']), 1)

    expect(result.candidates).toHaveLength(1)
    expect(result.incompletePaths).toEqual([root])
  })
})

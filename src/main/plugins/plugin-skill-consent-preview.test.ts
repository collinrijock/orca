import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { pluginManifestSchema } from '../../shared/plugins/plugin-manifest'
import { hashPluginTree, readPluginTreeSnapshot } from './plugin-content-hash'
import type { ValidDiscoveredPlugin } from './plugin-discovery'
import type { PluginService } from './plugin-service'
import {
  previewPluginConsent,
  readPluginSkillConsentPreviewsFromSnapshot
} from './plugin-skill-consent-preview'

async function discoveredSkillPlugin(rootDir: string, id: string): Promise<ValidDiscoveredPlugin> {
  const content = await hashPluginTree(rootDir)
  if (!content.ok) {
    throw new Error(content.error)
  }
  return {
    pluginKey: `orca-samples.${id}`,
    rootDir,
    manifest: pluginManifestSchema.parse({
      manifestVersion: 1,
      id,
      publisher: 'orca-samples',
      name: id,
      version: '1.0.0',
      engines: { orca: '>=1.0.0' },
      pluginApi: 1,
      contributes: { skills: [{ path: 'skills' }] },
      capabilities: []
    }),
    consentFingerprint: `sha256-${id}`,
    consentContentHash: content.hash,
    contentHash: null,
    isDev: true
  }
}

function serviceFor(...plugins: ValidDiscoveredPlugin[]): PluginService {
  return {
    findValidPlugin: (pluginKey: string) =>
      plugins.find((plugin) => plugin.pluginKey === pluginKey) ?? null
  } as unknown as PluginService
}

async function writeSkill(
  rootDir: string,
  name: string,
  instructions: string | Buffer
): Promise<void> {
  const directory = join(rootDir, 'skills', name)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'SKILL.md'), instructions)
}

describe('lazy plugin consent preview', () => {
  it('returns exact instructions only for the reviewed plugin fingerprint', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'orca-skill-preview-'))
    try {
      await writeSkill(rootDir, 'review', '# Review\n\nInspect the complete patch.')
      const plugin = await discoveredSkillPlugin(rootDir, 'review')
      const service = serviceFor(plugin)

      await expect(
        previewPluginConsent(service, {
          pluginKey: plugin.pluginKey,
          reviewedFingerprint: plugin.consentFingerprint
        })
      ).resolves.toEqual({
        ok: true,
        skills: [{ name: 'review', instructions: '# Review\n\nInspect the complete patch.' }]
      })

      await expect(
        previewPluginConsent(service, {
          pluginKey: plugin.pluginKey,
          reviewedFingerprint: 'sha256-stale'
        })
      ).resolves.toEqual({
        ok: false,
        error: 'plugin consent preview unavailable'
      })
    } finally {
      await rm(rootDir, { recursive: true, force: true })
    }
  })

  it('fails closed without exposing a changed development path', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'orca-private-skill-preview-'))
    try {
      await writeSkill(rootDir, 'review', '# Before')
      const plugin = await discoveredSkillPlugin(rootDir, 'changed')
      await writeSkill(rootDir, 'review', '# After')

      const result = await previewPluginConsent(serviceFor(plugin), {
        pluginKey: plugin.pluginKey,
        reviewedFingerprint: plugin.consentFingerprint
      })

      expect(result).toEqual({ ok: false, error: 'plugin consent preview unavailable' })
      expect(JSON.stringify(result)).not.toContain(rootDir)
    } finally {
      await rm(rootDir, { recursive: true, force: true })
    }
  })

  it('renders instructions from the same buffers that produced the reviewed hash', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'orca-skill-snapshot-'))
    try {
      await writeSkill(rootDir, 'review', '# Safe')
      const plugin = await discoveredSkillPlugin(rootDir, 'snapshot')
      const loaded = await readPluginTreeSnapshot(rootDir)
      if (!loaded.ok) {
        throw new Error(loaded.error)
      }
      await writeSkill(rootDir, 'review', '# Evil')

      expect(loaded.snapshot.hash).toBe(plugin.consentContentHash)
      expect(readPluginSkillConsentPreviewsFromSnapshot(plugin, loaded.snapshot)).toEqual([
        { name: 'review', instructions: '# Safe' }
      ])
    } finally {
      await rm(rootDir, { recursive: true, force: true })
    }
  })

  it('does not let one oversized pack starve a later plugin preview', async () => {
    const largeRoot = await mkdtemp(join(tmpdir(), 'orca-large-skill-preview-'))
    const smallRoot = await mkdtemp(join(tmpdir(), 'orca-small-skill-preview-'))
    try {
      for (let index = 0; index < 17; index += 1) {
        await writeSkill(largeRoot, `large-${index}`, Buffer.alloc(256 * 1024, 97))
      }
      await writeSkill(smallRoot, 'small', '# Small')
      const large = await discoveredSkillPlugin(largeRoot, 'large')
      const small = await discoveredSkillPlugin(smallRoot, 'small')
      const service = serviceFor(large, small)

      await expect(
        previewPluginConsent(service, {
          pluginKey: large.pluginKey,
          reviewedFingerprint: large.consentFingerprint
        })
      ).resolves.toEqual({ ok: false, error: 'plugin consent preview unavailable' })
      await expect(
        previewPluginConsent(service, {
          pluginKey: small.pluginKey,
          reviewedFingerprint: small.consentFingerprint
        })
      ).resolves.toEqual({
        ok: true,
        skills: [{ name: 'small', instructions: '# Small' }]
      })
    } finally {
      await Promise.all([
        rm(largeRoot, { recursive: true, force: true }),
        rm(smallRoot, { recursive: true, force: true })
      ])
    }
  })
})

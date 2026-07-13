import { describe, expect, it } from 'vitest'
import { fingerprintPluginConsent } from '../../shared/plugins/plugin-consent-fingerprint'
import { pluginManifestSchema } from '../../shared/plugins/plugin-manifest'
import type { Repo } from '../../shared/types'
import type { ValidDiscoveredPlugin } from './plugin-discovery'
import { authorizePluginSkillMapping } from './plugin-skill-mapping-authority'

function plugin(): ValidDiscoveredPlugin {
  const manifest = pluginManifestSchema.parse({
    manifestVersion: 1,
    id: 'skills',
    publisher: 'orca-samples',
    name: 'Skills',
    version: '1.0.0',
    engines: { orca: '>=1.0.0' },
    pluginApi: 1,
    contributes: { skills: [{ path: 'skills', providers: ['codex'] }] },
    capabilities: []
  })
  return {
    pluginKey: 'orca-samples.skills',
    rootDir: '/plugins/skills',
    manifest,
    consentFingerprint: fingerprintPluginConsent(manifest),
    contentHash: null,
    isDev: true
  }
}

function repo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 'repo-1',
    path: '/projects/orca',
    displayName: 'Orca',
    ...overrides
  } as Repo
}

describe('plugin skill mapping authority', () => {
  it('allows declared providers in registered local repositories', () => {
    expect(
      authorizePluginSkillMapping(
        {
          pluginKey: 'orca-samples.skills',
          contributionPath: 'skills',
          targets: [{ scope: 'repository', repositoryPath: '/projects/orca', providers: ['codex'] }]
        },
        [plugin()],
        [repo()]
      )
    ).toMatchObject({ pluginKey: 'orca-samples.skills' })
  })

  it('rejects arbitrary paths, remote repositories, and undeclared providers', () => {
    const base = { pluginKey: 'orca-samples.skills', contributionPath: 'skills' }
    expect(() =>
      authorizePluginSkillMapping(
        {
          ...base,
          targets: [{ scope: 'repository', repositoryPath: '/tmp/arbitrary', providers: ['codex'] }]
        },
        [plugin()],
        [repo()]
      )
    ).toThrow(/registered local project/)
    expect(() =>
      authorizePluginSkillMapping(
        {
          ...base,
          targets: [{ scope: 'repository', repositoryPath: '/remote/orca', providers: ['codex'] }]
        },
        [plugin()],
        [repo({ path: '/remote/orca', connectionId: 'ssh-1' })]
      )
    ).toThrow(/registered local project/)
    expect(() =>
      authorizePluginSkillMapping(
        { ...base, targets: [{ scope: 'user', providers: ['claude'] }] },
        [plugin()],
        [repo()]
      )
    ).toThrow(/not declared/)
  })
})

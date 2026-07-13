import { describe, expect, it } from 'vitest'
import { parsePluginManifest, pluginManifestSchema } from './plugin-manifest'

function manifest(contributes: Record<string, unknown>): Record<string, unknown> {
  return {
    manifestVersion: 1,
    id: 'content-pack',
    publisher: 'orca-samples',
    name: 'Content pack',
    version: '1.0.0',
    engines: { orca: '>=1.0.0' },
    pluginApi: 1,
    contributes,
    capabilities: []
  }
}

describe('content-pack manifest contributions', () => {
  it('accepts the documented P1 contribution set without a worker', () => {
    const parsed = pluginManifestSchema.parse(
      manifest({
        themes: [{ id: 'nord', label: 'Nord', path: 'themes/nord.json' }],
        iconThemes: [{ id: 'minimal', path: 'icons/minimal.json' }],
        terminalThemes: [
          { id: 'nord-terminal', label: 'Nord Terminal', path: 'terminal/nord.json' }
        ],
        languagePacks: [{ locale: 'pt-BR', path: 'locales/pt-BR.json' }],
        skills: [{ path: 'skills/', providers: ['codex', 'claude'] }],
        commands: [
          {
            id: 'workspace.openTasks',
            title: 'Open tasks',
            context: 'worktree',
            action: 'view.tasks'
          }
        ],
        keybindings: [{ command: 'workspace.openTasks', key: 'Mod+Alt+T' }],
        vmRecipes: [{ path: 'recipes/fly.json' }],
        agents: [{ path: 'agents/custom.json' }]
      })
    )

    expect(parsed.main).toBeUndefined()
    expect(parsed.contributes.skills[0]?.path).toBe('skills')
    expect(parsed.contributes.languagePacks[0]?.locale).toBe('pt-BR')
  })

  it('defaults every contribution registry to an empty array', () => {
    const parsed = pluginManifestSchema.parse(manifest({}))

    expect(parsed.contributes).toEqual({
      panels: [],
      commands: [],
      events: [],
      themes: [],
      iconThemes: [],
      terminalThemes: [],
      languagePacks: [],
      skills: [],
      keybindings: [],
      vmRecipes: [],
      agents: []
    })
  })

  it('still requires a worker entry for non-alias commands', () => {
    expect(
      parsePluginManifest(
        manifest({ commands: [{ id: 'content-pack.run', title: 'Run content pack' }] })
      )
    ).toMatchObject({ ok: false, error: expect.stringContaining('worker command') })
  })

  it.each([
    ['theme', { themes: [{ id: 'bad', label: 'Bad', path: '../outside.json' }] }],
    ['icon theme', { iconThemes: [{ id: 'bad', path: '/tmp/icons.json' }] }],
    ['language pack', { languagePacks: [{ locale: 'en_US', path: 'locale.json' }] }],
    ['skills', { skills: [{ path: 'C:\\skills' }] }],
    ['VM recipe', { vmRecipes: [{ path: '\\\\server\\recipe.json' }] }],
    ['agent profile', { agents: [{ path: 'agents/../profile.json' }] }]
  ])('rejects unsafe or malformed %s contributions', (_label, contributes) => {
    expect(parsePluginManifest(manifest(contributes)).ok).toBe(false)
  })

  it('rejects duplicate ids, locales, paths, and bindings', () => {
    const parsed = pluginManifestSchema.safeParse(
      manifest({
        themes: [
          { id: 'same', label: 'One', path: 'one.json' },
          { id: 'same', label: 'Two', path: 'two.json' }
        ],
        languagePacks: [
          { locale: 'pt-BR', path: 'pt-br.json' },
          { locale: 'pt-br', path: 'other.json' }
        ],
        skills: [{ path: 'skills' }, { path: 'skills/' }],
        commands: [{ id: 'open', title: 'Open', action: 'view.tasks' }],
        keybindings: [
          { command: 'open', key: 'Mod+T' },
          { command: 'open', key: 'mod+t' }
        ]
      })
    )

    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues.map((issue) => issue.message)).toEqual(
        expect.arrayContaining([
          'duplicate themes id: same',
          'duplicate language pack locale: pt-br',
          'duplicate skills path: skills'
        ])
      )
      expect(
        parsed.error.issues.some((issue) => issue.message.startsWith('duplicate keybinding:'))
      ).toBe(true)
    }
  })
})

import type { RefinementCtx } from 'zod'

type IdentifiedContribution = { id: string }
type PathContribution = { path: string }

type ContributionValidationManifest = {
  main?: string
  contributes: {
    panels: IdentifiedContribution[]
    commands: (IdentifiedContribution & { action?: string })[]
    events: { on: string }[]
    themes: IdentifiedContribution[]
    iconThemes: IdentifiedContribution[]
    terminalThemes: IdentifiedContribution[]
    languagePacks: { locale: string }[]
    skills: PathContribution[]
    keybindings: { command: string; key: string }[]
    vmRecipes: PathContribution[]
    agents: PathContribution[]
  }
  capabilities: { kind: string }[]
}

function rejectDuplicateValues(
  entries: readonly unknown[],
  valueOf: (entry: unknown) => string,
  path: string,
  label: string,
  ctx: RefinementCtx
): void {
  const seen = new Set<string>()
  for (const [index, entry] of entries.entries()) {
    const value = valueOf(entry)
    if (seen.has(value)) {
      ctx.addIssue({
        code: 'custom',
        path: ['contributes', path, index],
        message: `duplicate ${label}: ${value}`
      })
    }
    seen.add(value)
  }
}

export function validatePluginManifestContributions(
  manifest: ContributionValidationManifest,
  ctx: RefinementCtx
): void {
  for (const path of ['panels', 'commands', 'themes', 'iconThemes', 'terminalThemes'] as const) {
    rejectDuplicateValues(
      manifest.contributes[path],
      (entry) => (entry as IdentifiedContribution).id,
      path,
      `${path} id`,
      ctx
    )
  }
  rejectDuplicateValues(
    manifest.contributes.languagePacks,
    (entry) => (entry as { locale: string }).locale.toLowerCase(),
    'languagePacks',
    'language pack locale',
    ctx
  )
  for (const path of ['skills', 'vmRecipes', 'agents'] as const) {
    rejectDuplicateValues(
      manifest.contributes[path],
      (entry) => (entry as PathContribution).path,
      path,
      `${path} path`,
      ctx
    )
  }
  rejectDuplicateValues(
    manifest.contributes.keybindings,
    (entry) => {
      const keybinding = entry as { command: string; key: string }
      return `${keybinding.command}\u0000${keybinding.key.toLowerCase()}`
    },
    'keybindings',
    'keybinding',
    ctx
  )

  if (
    !manifest.main &&
    manifest.contributes.commands.some((command) => command.action === undefined)
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['main'],
      message: 'required when contributes.commands contains a worker command'
    })
  }
  if (!manifest.main && manifest.contributes.events.length > 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['main'],
      message: 'required when contributes.events is non-empty'
    })
  }
  if (
    manifest.contributes.events.length > 0 &&
    !manifest.capabilities.some((capability) => capability.kind === 'events:subscribe')
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['capabilities'],
      message: 'events:subscribe capability required when contributes.events is non-empty'
    })
  }
}

import { PLUGIN_SKILL_PROVIDERS } from '../../shared/plugins/plugin-content-pack-contributions'
import {
  pluginSkillContributionMappingSchema,
  type PluginSkillContributionMapping
} from '../../shared/plugins/plugin-skill-store'
import type { Repo } from '../../shared/types'
import { areRuntimePathsEqual } from '../../shared/worktree-ownership'
import { isInvalidDiscoveredPlugin, type DiscoveredPlugin } from './plugin-discovery'

export function authorizePluginSkillMapping(
  args: unknown,
  discovered: readonly DiscoveredPlugin[],
  repos: readonly Repo[]
): PluginSkillContributionMapping {
  const mapping = pluginSkillContributionMappingSchema.parse(args)
  const plugin = discovered.find((candidate) => candidate.pluginKey === mapping.pluginKey)
  if (!plugin || isInvalidDiscoveredPlugin(plugin)) {
    throw new Error('plugin is not installed')
  }
  const contribution = plugin.manifest.contributes.skills.find(
    (candidate) => candidate.path === mapping.contributionPath
  )
  if (!contribution) {
    throw new Error('plugin skill contribution is not installed')
  }
  const allowedProviders = new Set(contribution.providers ?? PLUGIN_SKILL_PROVIDERS)
  if (
    mapping.targets.some((target) =>
      target.providers.some((provider) => !allowedProviders.has(provider))
    )
  ) {
    throw new Error('skill mapping includes a provider not declared by the plugin')
  }
  const localRepos = repos.filter((repo) => !repo.connectionId)
  if (
    mapping.targets.some(
      (target) =>
        target.scope === 'repository' &&
        !localRepos.some((repo) => areRuntimePathsEqual(repo.path, target.repositoryPath!))
    )
  ) {
    // Why: remote-host sync is P2, and renderer text must not authorize writes
    // into arbitrary local paths outside Orca's registered repositories.
    throw new Error('repository skill target must be a registered local project')
  }
  return mapping
}

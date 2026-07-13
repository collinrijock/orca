import { homedir } from 'node:os'
import { PLUGIN_SKILL_PROVIDERS } from '../../shared/plugins/plugin-content-pack-contributions'
import type {
  PluginSkillContributionMapping,
  PluginSkillRegistration
} from '../../shared/plugins/plugin-skill-store'
import type { PluginContentVerifier } from './plugin-content-integrity'
import { mapPluginContentWithConcurrency } from './plugin-content-load-pool'
import {
  isInvalidDiscoveredPlugin,
  type DiscoveredPlugin,
  type ValidDiscoveredPlugin
} from './plugin-discovery'
import { PluginSkillMappingStore } from './plugin-skill-mapping-store'
import {
  PluginSkillMaterializer,
  type PluginSkillMaterializationSpec
} from './plugin-skill-materializer'
import { readPluginSkillPackages } from './plugin-skill-package-reader'

const SKILL_LOAD_CONCURRENCY = 4

type SkillLoadResult =
  | { pluginKey: string; specs: PluginSkillMaterializationSpec[] }
  | { pluginKey: string; error: string }

export class PluginSkillRegistry {
  private registrations: PluginSkillRegistration[] = []
  private readonly errors = new Map<string, string>()
  readonly mappings: PluginSkillMappingStore
  private readonly materializer: PluginSkillMaterializer

  constructor(
    private readonly contentVerifier: PluginContentVerifier,
    pluginsDataDir: string,
    homeDirectory = homedir()
  ) {
    this.mappings = new PluginSkillMappingStore(pluginsDataDir)
    this.materializer = new PluginSkillMaterializer(homeDirectory, pluginsDataDir)
  }

  list(): readonly PluginSkillRegistration[] {
    return this.registrations
  }

  error(pluginKey: string): string | null {
    return this.errors.get(pluginKey) ?? null
  }

  async setMapping(mapping: PluginSkillContributionMapping): Promise<void> {
    await this.mappings.set(mapping)
  }

  async reconcile(
    discovered: readonly DiscoveredPlugin[],
    isApproved: (plugin: ValidDiscoveredPlugin) => boolean
  ): Promise<void> {
    const candidates = discovered.filter(
      (plugin): plugin is ValidDiscoveredPlugin =>
        !isInvalidDiscoveredPlugin(plugin) &&
        isApproved(plugin) &&
        plugin.manifest.contributes.skills.length > 0
    )
    const loaded = await mapPluginContentWithConcurrency(
      candidates,
      SKILL_LOAD_CONCURRENCY,
      async (plugin): Promise<SkillLoadResult> => {
        try {
          await this.contentVerifier.verify(plugin)
          const specs: PluginSkillMaterializationSpec[] = []
          for (const contribution of plugin.manifest.contributes.skills) {
            const providers = contribution.providers ?? [...PLUGIN_SKILL_PROVIDERS]
            const [skills, targets] = await Promise.all([
              readPluginSkillPackages(plugin.rootDir, contribution.path),
              this.mappings.targetsFor(plugin.pluginKey, contribution.path, providers)
            ])
            for (const skill of skills) {
              specs.push({
                pluginKey: plugin.pluginKey,
                contributionPath: contribution.path,
                providers,
                skill,
                targets
              })
            }
          }
          return { pluginKey: plugin.pluginKey, specs }
        } catch (error) {
          return {
            pluginKey: plugin.pluginKey,
            error: error instanceof Error ? error.message : String(error)
          }
        }
      }
    )
    const materialized = await this.materializer.reconcile(
      loaded.flatMap((result) => ('specs' in result ? result.specs : []))
    )
    this.registrations = materialized.registrations
    this.errors.clear()
    for (const result of loaded) {
      if ('error' in result) {
        this.errors.set(result.pluginKey, result.error)
      }
    }
    for (const [pluginKey, error] of materialized.errors) {
      this.errors.set(pluginKey, error)
    }
  }
}

import type { PluginContentVerifier } from './plugin-content-integrity'
import type { DiscoveredPlugin, ValidDiscoveredPlugin } from './plugin-discovery'
import { PluginLanguagePackRegistry } from './plugin-language-pack-registry'
import { PluginSkillRegistry } from './plugin-skill-registry'
import { PluginThemeRegistry } from './plugin-theme-registry'

export class PluginContentPackRegistry {
  readonly themes: PluginThemeRegistry
  readonly languagePacks: PluginLanguagePackRegistry
  readonly skills: PluginSkillRegistry

  constructor(
    contentVerifier: PluginContentVerifier,
    options: { pluginsDataDir: string; homeDirectory?: string }
  ) {
    this.themes = new PluginThemeRegistry(contentVerifier)
    this.languagePacks = new PluginLanguagePackRegistry(contentVerifier)
    this.skills = new PluginSkillRegistry(
      contentVerifier,
      options.pluginsDataDir,
      options.homeDirectory
    )
  }

  async reconcile(
    discovered: readonly DiscoveredPlugin[],
    isApproved: (plugin: ValidDiscoveredPlugin) => boolean
  ): Promise<void> {
    await Promise.all([
      this.themes.reconcile(discovered, isApproved),
      this.languagePacks.reconcile(discovered, isApproved),
      this.skills.reconcile(discovered, isApproved)
    ])
  }

  error(pluginKey: string): string | null {
    return (
      this.themes.error(pluginKey) ??
      this.languagePacks.error(pluginKey) ??
      this.skills.error(pluginKey)
    )
  }
}

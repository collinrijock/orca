import type { PluginContentVerifier } from './plugin-content-integrity'
import type { DiscoveredPlugin, ValidDiscoveredPlugin } from './plugin-discovery'
import { PluginLanguagePackRegistry } from './plugin-language-pack-registry'
import { PluginThemeRegistry } from './plugin-theme-registry'

export class PluginContentPackRegistry {
  readonly themes: PluginThemeRegistry
  readonly languagePacks: PluginLanguagePackRegistry

  constructor(contentVerifier: PluginContentVerifier) {
    this.themes = new PluginThemeRegistry(contentVerifier)
    this.languagePacks = new PluginLanguagePackRegistry(contentVerifier)
  }

  async reconcile(
    discovered: readonly DiscoveredPlugin[],
    isApproved: (plugin: ValidDiscoveredPlugin) => boolean
  ): Promise<void> {
    await Promise.all([
      this.themes.reconcile(discovered, isApproved),
      this.languagePacks.reconcile(discovered, isApproved)
    ])
  }

  error(pluginKey: string): string | null {
    return this.themes.error(pluginKey) ?? this.languagePacks.error(pluginKey)
  }
}

import { Loader2, RefreshCw } from 'lucide-react'
import type { PluginHostListEntry } from '../../../../preload/api-types'
import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'
import { PluginDevelopmentSection } from './PluginDevelopmentSection'
import { PluginSettingsRow, type PluginLogsState } from './PluginSettingsRow'
import { SettingsRow, SettingsSwitch } from './SettingsFormControls'

type PluginSettingsOverviewProps = {
  featureEnabled: boolean
  featureBusy: boolean
  settingsError: string | null
  loading: boolean
  refreshBusy: boolean
  error: string | null
  plugins: PluginHostListEntry[]
  busyPluginKeys: ReadonlySet<string>
  openLogs: ReadonlySet<string>
  logsByPlugin: Readonly<Record<string, PluginLogsState>>
  devPaths: readonly string[]
  devPathsBusy: boolean
  onToggleFeature: () => void
  onRefresh: () => void
  onReview: (pluginKey: string) => void
  onToggleEnabled: (plugin: PluginHostListEntry) => void
  onToggleLogs: (pluginKey: string) => void
  onConfigureSkills: (pluginKey: string) => void
  onRemoveRequest: (pluginKey: string) => void
  onUpdateDevPaths: (paths: string[]) => Promise<void>
}

export function PluginSettingsOverview({
  featureEnabled,
  featureBusy,
  settingsError,
  loading,
  refreshBusy,
  error,
  plugins,
  busyPluginKeys,
  openLogs,
  logsByPlugin,
  devPaths,
  devPathsBusy,
  onToggleFeature,
  onRefresh,
  onReview,
  onToggleEnabled,
  onToggleLogs,
  onConfigureSkills,
  onRemoveRequest,
  onUpdateDevPaths
}: PluginSettingsOverviewProps): React.JSX.Element {
  return (
    <>
      <SettingsRow
        label={translate(
          'auto.components.settings.PluginsSettingsSection.systemLabel',
          'Plugin system'
        )}
        labelId="plugin-system-label"
        description={translate(
          'auto.components.settings.PluginsSettingsSection.systemDescription',
          'Discovers installed plugins and lets you enable them individually. Nothing runs until you review and enable it. Workers always run on this computer; SSH workspace actions route through Orca.'
        )}
        alignTop
        control={
          <SettingsSwitch
            checked={featureEnabled}
            disabled={featureBusy}
            ariaLabelledBy="plugin-system-label"
            onChange={onToggleFeature}
          />
        }
      />
      {settingsError ? <p className="text-xs text-destructive">{settingsError}</p> : null}
      <div className="my-4 border-t border-border/60" />
      {!featureEnabled ? (
        <div className="rounded-lg border border-dashed border-border px-5 py-6 text-center text-[13px] leading-6 text-muted-foreground">
          {translate(
            'auto.components.settings.PluginsSettingsSection.featureOff',
            'Turn on the plugin system to see and manage installed plugins. Anything already installed stays on disk and stays disabled while the system is off.'
          )}
        </div>
      ) : loading ? (
        <div className="flex items-center gap-2 px-4 py-5 text-[13px] text-muted-foreground">
          <Loader2 className="animate-spin" />
          {translate('auto.components.settings.PluginsSettingsSection.loading', 'Loading plugins…')}
        </div>
      ) : (
        <>
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
              {translate('auto.components.settings.PluginsSettingsSection.installed', 'Installed')}
            </span>
            <Button variant="ghost" size="xs" disabled={refreshBusy} onClick={onRefresh}>
              <RefreshCw className={refreshBusy ? 'animate-spin' : undefined} />
              {translate('auto.components.settings.PluginsSettingsSection.refresh', 'Refresh')}
            </Button>
          </div>
          {error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              <p>{error}</p>
              <Button variant="outline" size="xs" className="mt-2" onClick={onRefresh}>
                {translate('auto.components.settings.PluginsSettingsSection.tryAgain', 'Try again')}
              </Button>
            </div>
          ) : plugins.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border px-5 py-6 text-center text-[13px] leading-6 text-muted-foreground">
              {translate(
                'auto.components.settings.PluginsSettingsSection.empty',
                'No plugins installed. Use Install plugin to add one from a local folder or a pinned git ref.'
              )}
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border/80">
              {plugins.map((plugin) => (
                <PluginSettingsRow
                  key={plugin.pluginKey}
                  plugin={plugin}
                  busy={busyPluginKeys.has(plugin.pluginKey)}
                  logsOpen={openLogs.has(plugin.pluginKey)}
                  logsState={logsByPlugin[plugin.pluginKey]}
                  onReview={onReview}
                  onToggleEnabled={onToggleEnabled}
                  onToggleLogs={onToggleLogs}
                  onConfigureSkills={onConfigureSkills}
                  onRemoveRequest={onRemoveRequest}
                />
              ))}
            </div>
          )}
          <div className="my-4 border-t border-border/60" />
          <PluginDevelopmentSection
            paths={devPaths}
            busy={devPathsBusy}
            onChange={onUpdateDevPaths}
          />
        </>
      )}
    </>
  )
}

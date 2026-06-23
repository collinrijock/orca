import type { GlobalSettings } from '../../../../shared/types'
import { Label } from '../ui/label'
import { SearchableSetting } from './SearchableSetting'
import { getExperimentalSearchEntry } from './experimental-search'
import { translate } from '@/i18n/i18n'

type ExperimentalSmartNewTabSettingProps = {
  enabled: boolean
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function ExperimentalSmartNewTabSetting({
  enabled,
  updateSettings
}: ExperimentalSmartNewTabSettingProps): React.JSX.Element {
  return (
    <SearchableSetting
      title={translate(
        'auto.components.settings.ExperimentalPane.847886cf3e',
        'Smart New Tab menu'
      )}
      description={translate(
        'auto.components.settings.ExperimentalPane.523b819a55',
        'Type in the New Tab menu to open a terminal, launch an agent, visit a URL, or open/create a file.'
      )}
      keywords={getExperimentalSearchEntry().unifiedNewTabLauncher.keywords}
      className="space-y-3 py-2"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 shrink space-y-0.5">
          <Label>
            {translate(
              'auto.components.settings.ExperimentalPane.847886cf3e',
              'Smart New Tab menu'
            )}
          </Label>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.ExperimentalPane.523b819a55',
              'Type in the New Tab menu to open a terminal, launch an agent, visit a URL, or open/create a file.'
            )}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() =>
            updateSettings({
              experimentalUnifiedNewTabLauncher: !enabled
            })
          }
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors ${
            enabled ? 'bg-foreground' : 'bg-muted-foreground/30'
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-background shadow-sm transition-transform ${
              enabled ? 'translate-x-4' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>
    </SearchableSetting>
  )
}

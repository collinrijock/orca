import type { GlobalSettings } from '../../../../shared/types'
import { translate } from '@/i18n/i18n'
import { Label } from '../ui/label'
import { getExperimentalSearchEntry } from './experimental-search'
import { SearchableSetting } from './SearchableSetting'
import { SettingsSwitch } from './SettingsFormControls'

type TerminalParkingExperimentalSettingProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function TerminalParkingExperimentalSetting({
  settings,
  updateSettings
}: TerminalParkingExperimentalSettingProps): React.JSX.Element {
  const entry = getExperimentalSearchEntry().terminalParking
  // Experimental opt-in, default-off: strict `=== true` matches the parking
  // gates, so an absent/null setting keeps the toggle (and parking) off.
  const enabled = settings.terminalHiddenViewParking === true

  return (
    <SearchableSetting
      title={entry.title}
      description={entry.description}
      keywords={entry.keywords}
      className="space-y-3 py-2"
      id="experimental-terminal-parking"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 shrink space-y-0.5">
          <Label>
            {translate(
              'auto.components.settings.ExperimentalPane.terminalParking.title',
              'Park hidden terminals'
            )}
          </Label>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.ExperimentalPane.terminalParking.copy',
              'Reclaims renderer memory in workspaces with many terminals by unmounting panes that have been hidden for a while; a lightweight watcher keeps bell, title, and agent-completion notifications alive, and panes restore when you reopen the worktree. Excludes SSH and remote terminals. Experimental while we validate restore fidelity for full-screen agent UIs.'
            )}
          </p>
        </div>
        <SettingsSwitch
          checked={enabled}
          ariaLabel={translate(
            'auto.components.settings.ExperimentalPane.terminalParking.toggleLabel',
            'Toggle hidden terminal parking'
          )}
          onChange={() => updateSettings({ terminalHiddenViewParking: !enabled })}
        />
      </div>
    </SearchableSetting>
  )
}

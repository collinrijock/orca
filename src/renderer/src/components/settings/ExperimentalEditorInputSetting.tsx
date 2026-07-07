import type React from 'react'
import type { GlobalSettings } from '../../../../shared/types'
import { translate } from '@/i18n/i18n'
import { SearchableSetting } from './SearchableSetting'
import { SettingsSwitchRow } from './SettingsFormControls'

type ExperimentalEditorInputSettingProps = {
  settings: Pick<GlobalSettings, 'editorExperimentalInput'>
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function ExperimentalEditorInputSetting({
  settings,
  updateSettings
}: ExperimentalEditorInputSettingProps): React.JSX.Element {
  const enabled = settings.editorExperimentalInput ?? false

  return (
    <SearchableSetting
      title={translate(
        'auto.components.settings.GeneralEditorSettingsSection.30baaa4a0f',
        'Experimental Editor Input'
      )}
      description={translate(
        'auto.components.settings.GeneralEditorSettingsSection.f5663213a9',
        'Power editor typing with the Chromium EditContext API. Leave this off if typing ever stops working in the editor; the classic input path is more reliable.'
      )}
      keywords={['editcontext', 'input', 'typing', 'ime', 'keyboard', 'experimental']}
    >
      <SettingsSwitchRow
        label={translate(
          'auto.components.settings.GeneralEditorSettingsSection.30baaa4a0f',
          'Experimental Editor Input'
        )}
        description={translate(
          'auto.components.settings.GeneralEditorSettingsSection.f5663213a9',
          'Power editor typing with the Chromium EditContext API. Leave this off if typing ever stops working in the editor; the classic input path is more reliable.'
        )}
        checked={enabled}
        onChange={() => updateSettings({ editorExperimentalInput: !enabled })}
      />
    </SearchableSetting>
  )
}

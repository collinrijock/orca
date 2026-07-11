import type { SettingsSearchEntry } from './settings-search'
import { translate } from '@/i18n/i18n'
import { translateSearchKeyword } from './settings-search-keywords'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'

export const getTerminalWindowsShellSearchEntry = createLocalizedCatalog(() => [
  {
    title: translate(
      'auto.components.settings.terminal.windows.search.13715f9d23',
      'Default Shell'
    ),
    description: translate(
      'auto.components.settings.terminal.windows.search.713c4a2f92',
      'Choose the default shell for new terminal panes on Windows.'
    ),
    keywords: [
      ...translateSearchKeyword(
        'auto.components.settings.terminal.windows.search.e7d2793b03',
        'terminal'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.terminal.windows.search.28ff08ed35',
        'windows'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.terminal.windows.search.7c7056940a',
        'shell'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.terminal.windows.search.2d99cd91be',
        'powershell'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.terminal.windows.search.6cd20b9e64',
        'cmd'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.terminal.windows.search.12519edb5d',
        'command prompt'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.terminal.windows.search.04994f6929',
        'default'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.terminal.windows.search.591912177b',
        'git bash'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.terminal.windows.search.5a2db98d23',
        'bash'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.terminal.windows.search.07ec155fb6',
        'bash.exe'
      )
    ]
  }
])

export const getTerminalWindowsPowershellImplementationSearchEntry = createLocalizedCatalog(() => [
  {
    title: translate(
      'auto.components.settings.terminal.windows.search.860e0e6402',
      'PowerShell Version'
    ),
    description: translate(
      'auto.components.settings.terminal.windows.search.41a69bc24d',
      'Choose whether the PowerShell shell option launches Windows PowerShell or PowerShell 7+ for new terminal panes.'
    ),
    keywords: [
      ...translateSearchKeyword(
        'auto.components.settings.terminal.windows.search.e7d2793b03',
        'terminal'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.terminal.windows.search.28ff08ed35',
        'windows'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.terminal.windows.search.2d99cd91be',
        'powershell'
      ),
      translate(
        'auto.components.settings.terminal.windows.search.f9162f0b8e',
        'windows powershell'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.terminal.windows.search.768613e483',
        'powershell 7'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.terminal.windows.search.d414022016',
        'pwsh'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.terminal.windows.search.4af2f7526e',
        'version'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.terminal.windows.search.d57f870938',
        'advanced'
      )
    ]
  }
])

export const getTerminalRightClickToPasteSearchEntry = createLocalizedCatalog(() => [
  {
    title: translate(
      'auto.components.settings.terminal.windows.search.f0b8448570',
      'Right-click to paste'
    ),
    description: translate(
      'auto.components.settings.terminal.windows.search.8ba875c132',
      'On Windows, right-click pastes the clipboard into the terminal. Use Ctrl+right-click to open the context menu.'
    ),
    keywords: [
      ...translateSearchKeyword(
        'auto.components.settings.terminal.windows.search.e7d2793b03',
        'terminal'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.terminal.windows.search.28ff08ed35',
        'windows'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.terminal.windows.search.e55186fe2b',
        'right click'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.terminal.windows.search.fcfa53920b',
        'paste'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.terminal.windows.search.4d09141a42',
        'context menu'
      )
    ]
  }
])

export const getTerminalGitCredentialPopupSearchEntry = createLocalizedCatalog(() => [
  {
    title: translate(
      'auto.components.settings.terminal.windows.search.8630676830',
      'Block Git Credential Popups'
    ),
    description: translate(
      'auto.components.settings.terminal.windows.search.9d8b09bc09',
      'Stop git in terminals from opening Git Credential Manager sign-in windows.'
    ),
    keywords: [
      ...translateSearchKeyword(
        'auto.components.settings.terminal.windows.search.e7d2793b03',
        'terminal'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.terminal.windows.search.28ff08ed35',
        'windows'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.terminal.windows.search.ba9f11ecc3',
        'git'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.terminal.windows.search.7c7c74ef60',
        'credential'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.terminal.windows.search.8eff361700',
        'popup'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.terminal.windows.search.7c82e855b0',
        'oauth'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.terminal.windows.search.bf215181b5',
        'github'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.terminal.windows.search.b19a25c6a0',
        'sign in'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.terminal.windows.search.ef5acdb939',
        'gcm'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.terminal.windows.search.4ae35dbb42',
        'prompt'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.terminal.windows.search.27e4a4878d',
        'credential manager'
      )
    ]
  }
])

export const getTerminalWindowsSearchEntries = createLocalizedCatalog((): SettingsSearchEntry[] => [
  ...getTerminalWindowsShellSearchEntry(),
  ...getTerminalWindowsPowershellImplementationSearchEntry(),
  ...getTerminalRightClickToPasteSearchEntry(),
  ...getTerminalGitCredentialPopupSearchEntry()
])

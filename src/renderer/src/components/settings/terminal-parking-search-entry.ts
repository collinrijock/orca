import type { SettingsSearchEntry } from './settings-search'
import { translate } from '@/i18n/i18n'
import { translateSearchKeyword } from './settings-search-keywords'

export function getTerminalParkingSearchEntry(): SettingsSearchEntry {
  return {
    title: translate(
      'auto.components.settings.experimental.search.terminalParking.title',
      'Park hidden terminals'
    ),
    description: translate(
      'auto.components.settings.experimental.search.terminalParking.description',
      'Free renderer memory by unmounting terminal panes hidden for a while; they restore when you reopen the worktree.'
    ),
    keywords: [
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.0d24759f14',
        'experimental'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.9bb3bd5098',
        'terminal'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.terminalParking.memory',
        'memory'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.terminalParking.parking',
        'parking'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.terminalParking.hidden',
        'hidden'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.terminalParking.performance',
        'performance'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.terminalParking.ram',
        'ram'
      )
    ]
  }
}

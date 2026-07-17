import type { ITheme } from '@xterm/xterm'
import type { GlobalSettings } from '../../../../shared/types'
import type { TerminalViewAttributes } from '../../../../shared/terminal-view-attributes'
import { getBuiltinTheme, resolveEffectiveTerminalAppearance } from '@/lib/terminal-theme'
import { composeActiveTerminalTheme } from './composed-terminal-theme'
import { publishTerminalViewAttributes } from './terminal-view-attributes-publisher'

/** Hidden-at-launch PTYs can query OSC 10/11 before any terminal pane mounts.
 * Keep this publication eager while the pane renderer remains lazy. */
export function publishTerminalViewAttributesAtAppStart(
  settings: GlobalSettings | null | undefined,
  systemPrefersDark: boolean,
  send?: (attributes: TerminalViewAttributes) => boolean
): boolean {
  if (!settings) {
    return false
  }
  const appearance = resolveEffectiveTerminalAppearance(settings, systemPrefersDark)
  const baseTheme: ITheme | null = appearance.theme ?? getBuiltinTheme(appearance.themeName)
  const theme = composeActiveTerminalTheme(baseTheme, settings)
  return send !== undefined
    ? publishTerminalViewAttributes(theme, appearance.mode, settings, send)
    : publishTerminalViewAttributes(theme, appearance.mode, settings)
}

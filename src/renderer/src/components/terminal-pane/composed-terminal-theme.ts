import type { ITheme } from '@xterm/xterm'
import type { GlobalSettings } from '../../../../shared/types'
import { HEX_COLOR_RE } from '../../../../shared/color-validation'

export function hexToRgba(hex: string, alpha: number): string {
  let clean = hex.replace('#', '')
  if (clean.length === 3) {
    clean = clean
      .split('')
      .map((character) => character + character)
      .join('')
  }
  const red = Number.parseInt(clean.slice(0, 2), 16)
  const green = Number.parseInt(clean.slice(2, 4), 16)
  const blue = Number.parseInt(clean.slice(4, 6), 16)
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

export function isHexColor(value: string): boolean {
  return HEX_COLOR_RE.test(value)
}

// Why: startup publishes the composed colors before any pane mounts. Keep this
// module free of pane-manager values so that correctness does not preload xterm.
export function composeActiveTerminalTheme(
  baseTheme: ITheme | null,
  settings: Pick<
    GlobalSettings,
    'terminalColorOverrides' | 'terminalBackgroundOpacity' | 'terminalCursorOpacity'
  >
): ITheme | null {
  if (!baseTheme) {
    return null
  }
  // Why: setting scrollbar.width enables xterm's overview ruler, whose border
  // defaults to the foreground color and paints a bright vertical line beside
  // the scrollbar. We only want the slimmer scrollbar, not the ruler chrome.
  // Why: xterm's default slider alpha (~0.2) is nearly invisible on dark
  // backgrounds; raise the contrast so the thumb reads. Placed before the
  // spread so an explicit theme value still wins.
  let theme: ITheme = {
    overviewRulerBorder: 'transparent',
    scrollbarSliderBackground: 'rgba(180, 180, 185, 0.4)',
    scrollbarSliderHoverBackground: 'rgba(180, 180, 185, 0.6)',
    scrollbarSliderActiveBackground: 'rgba(180, 180, 185, 0.8)',
    ...baseTheme
  }
  // Why: merge user-imported Ghostty color overrides on top of the resolved
  // base theme so individual colors can be tweaked without losing the rest.
  if (settings.terminalColorOverrides) {
    theme = { ...theme, ...settings.terminalColorOverrides }
  }
  // Why: Ghostty's background-opacity controls the terminal's base alpha.
  // Convert the hex background to rgba so xterm honors it when allowTransparency
  // is also set on the Terminal instance.
  if (settings.terminalBackgroundOpacity !== undefined && theme.background) {
    theme = {
      ...theme,
      background: hexToRgba(theme.background, settings.terminalBackgroundOpacity)
    }
  }
  // Why: Ghostty's cursor-opacity applies alpha to the cursor color. Only
  // converted when the resolved cursor is a hex value; named CSS colors are
  // left untouched because hexToRgba expects a hex input.
  if (settings.terminalCursorOpacity !== undefined && theme.cursor && isHexColor(theme.cursor)) {
    theme = {
      ...theme,
      cursor: hexToRgba(theme.cursor, settings.terminalCursorOpacity)
    }
  }
  return theme
}

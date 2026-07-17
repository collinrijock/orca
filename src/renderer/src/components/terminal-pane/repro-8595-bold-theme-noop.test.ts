import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ITheme } from '@xterm/xterm'
import { Terminal } from '@xterm/xterm'
import { composeActiveTerminalTheme } from './terminal-appearance'
import type { GlobalSettings } from '../../../../shared/types'

/**
 * Regression for #8595: Settings "Bold Text" / Ghostty bold-color was stored
 * on terminalColorOverrides.bold and spread into options.theme, but upstream
 * xterm ITheme had no `bold` key — renderers always used theme.foreground for
 * bold default-FG cells.
 *
 * The pinned xterm + addon-webgl patches accept theme.bold and use it as the
 * default foreground for bold, non-inverse cells. Explicit ANSI/RGB
 * foregrounds stay on their own palette path.
 */
describe('issue #8595 bold theme color', () => {
  const require = createRequire(import.meta.url)

  function settingsWith(partial: Partial<GlobalSettings>): GlobalSettings {
    return {
      terminalColorOverrides: undefined,
      terminalCursorOpacity: undefined,
      terminalBackgroundOpacity: undefined,
      ...partial
    } as GlobalSettings
  }

  function packageRoot(specifier: string): string {
    return dirname(require.resolve(`${specifier}/package.json`))
  }

  it('ITheme accepts bold and Terminal options preserve the override', () => {
    const theme: ITheme = {
      foreground: '#fafafa',
      bold: '#ffc600',
      background: '#101010'
    }
    // Why: if the pin regresses and drops ITheme.bold, this assignment fails
    // typecheck / the runtime options bag no longer carries the key.
    expect(theme.bold).toBe('#ffc600')

    const term = new Terminal({ allowProposedApi: true, theme })
    try {
      expect(term.options.theme?.bold).toBe('#ffc600')
      term.options.theme = {
        foreground: '#eeeeee',
        background: '#111111',
        bold: '#00ffaa'
      }
      expect(term.options.theme?.bold).toBe('#00ffaa')
      term.options.theme = {
        foreground: '#eeeeee',
        background: '#111111'
      }
      expect(term.options.theme?.bold).toBeUndefined()
    } finally {
      term.dispose()
    }
  })

  it('composeActiveTerminalTheme keeps terminalColorOverrides.bold on the live theme', () => {
    const composed = composeActiveTerminalTheme(
      { foreground: '#fafafa', background: '#101010' },
      settingsWith({ terminalColorOverrides: { bold: '#ff00aa' } })
    )
    expect(composed?.bold).toBe('#ff00aa')
    expect(composed?.foreground).toBe('#fafafa')

    const term = new Terminal({ allowProposedApi: true, theme: composed ?? undefined })
    try {
      expect(term.options.theme?.bold).toBe('#ff00aa')
    } finally {
      term.dispose()
    }
  })

  it('pinned xterm package resolves theme.bold into the ThemeService color set', () => {
    const root = packageRoot('@xterm/xterm')
    const typings = readFileSync(join(root, 'typings/xterm.d.ts'), 'utf8')
    const themeService = readFileSync(join(root, 'src/browser/services/ThemeService.ts'), 'utf8')
    const domRowFactory = readFileSync(
      join(root, 'src/browser/renderer/dom/DomRendererRowFactory.ts'),
      'utf8'
    )
    const lib = readFileSync(join(root, 'lib/xterm.js'), 'utf8')

    expect(typings).toMatch(/export interface ITheme \{[\s\S]*?bold\?: string/)
    // Why: fallback to foreground when bold is omitted matches Ghostty/iTerm
    // "no bold color configured" behavior.
    expect(themeService).toContain('colors.bold = parseColor(theme.bold, colors.foreground)')
    // Why: default FG inherits the row container color; bold default FG must
    // still paint when min-contrast does not emit an inline color.
    expect(domRowFactory).toContain('cell.isBold() && !isInverse ? colors.bold : colors.foreground')
    expect(domRowFactory).toContain('color:${colors.bold.css}')
    expect(lib).toContain('bold.css')
  })

  it('pinned webgl atlas uses colors.bold only for bold default-FG (not explicit ANSI)', () => {
    const root = packageRoot('@xterm/addon-webgl')
    const atlas = readFileSync(join(root, 'src/TextureAtlas.ts'), 'utf8')
    const charAtlas = readFileSync(join(root, 'src/CharAtlasUtils.ts'), 'utf8')

    expect(charAtlas).toContain('bold: colors.bold')
    expect(charAtlas).toContain('a.colors.bold.rgba === b.colors.bold.rgba')
    // Default-FG branch selects bold when the bold attribute is set.
    expect(atlas).toMatch(/else if \(bold\) \{\s*result = this\._config\.colors\.bold/)
    expect(atlas).toMatch(/if \(bold\) \{\s*return this\._config\.colors\.bold\.rgba/)
    // Explicit palette path still uses ANSI indices (drawBoldTextInBrightColors),
    // not the theme bold color.
    expect(atlas).toContain('if (this._config.drawBoldTextInBrightColors && bold && fgColor < 8)')
  })
})

// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../../../shared/types'
import { useAppStore } from '../../store'
import { TerminalAdvancedSection } from './TerminalAdvancedSection'

const i18nMock = vi.hoisted(() => ({
  language: 'en',
  translations: new Map<string, string>()
}))

vi.mock('@/i18n/i18n', () => ({
  i18n: {
    get language() {
      return i18nMock.language
    }
  },
  translate: (key: string, defaultValue: string) => i18nMock.translations.get(key) ?? defaultValue
}))

describe('TerminalAdvancedSection scrollback rows', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    i18nMock.language = 'en'
    i18nMock.translations.clear()
    useAppStore.setState({ settingsSearchQuery: '' })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    document.body.replaceChildren()
  })

  function renderSection(updateSettings = vi.fn()): void {
    act(() => {
      root.render(
        <TerminalAdvancedSection
          settings={{ terminalScrollbackRows: 5000 } as GlobalSettings}
          updateSettings={updateSettings}
          scrollbackMode="custom"
          setScrollbackMode={vi.fn()}
          searchQuery=""
          showWindowsPowerShellImplementation={false}
          showWindowsGitCredentialGuard={false}
          isMac={false}
        />
      )
    })
  }

  function getScrollbackRowsInput(): HTMLInputElement {
    const input = container.querySelector<HTMLInputElement>('input[type="number"]')
    if (!input) {
      throw new Error('scrollback rows input not found')
    }
    return input
  }

  function setNativeValue(input: HTMLInputElement, text: string): void {
    // Why: React reads controlled-input changes through the native value setter.
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setValue?.call(input, text)
  }

  function typeText(input: HTMLInputElement, text: string): void {
    act(() => {
      setNativeValue(input, text)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  function blurInput(input: HTMLInputElement): void {
    act(() => {
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })
  }

  function pressEnter(input: HTMLInputElement): void {
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
  }

  it('keeps custom row edits local until blur', () => {
    const updateSettings = vi.fn()
    renderSection(updateSettings)

    const input = getScrollbackRowsInput()
    typeText(input, '2')
    expect(input.value).toBe('2')
    typeText(input, '25')
    expect(input.value).toBe('25')
    expect(updateSettings).not.toHaveBeenCalled()

    blurInput(input)

    expect(updateSettings).toHaveBeenCalledWith({ terminalScrollbackRows: 1000 })
    expect(input.value).toBe('1000')
  })

  it('commits the normalized custom rows on Enter', () => {
    const updateSettings = vi.fn()
    renderSection(updateSettings)

    const input = getScrollbackRowsInput()
    typeText(input, '12345.9')
    pressEnter(input)

    expect(updateSettings).toHaveBeenCalledWith({ terminalScrollbackRows: 12345 })
    expect(input.value).toBe('12345')
  })

  it('keeps the credential setting visible for a localized keyword match', () => {
    i18nMock.language = 'es'
    i18nMock.translations.set(
      'auto.components.settings.terminal.windows.search.27e4a4878d',
      'gestor de credenciales'
    )
    useAppStore.setState({ settingsSearchQuery: 'gestor de credenciales' })

    act(() => {
      root.render(
        <TerminalAdvancedSection
          settings={{} as GlobalSettings}
          updateSettings={vi.fn()}
          scrollbackMode="preset"
          setScrollbackMode={vi.fn()}
          searchQuery="gestor de credenciales"
          showWindowsPowerShellImplementation={false}
          showWindowsGitCredentialGuard
          isMac={false}
        />
      )
    })

    expect(container.textContent).toContain('Block Git Credential Popups')
  })
})

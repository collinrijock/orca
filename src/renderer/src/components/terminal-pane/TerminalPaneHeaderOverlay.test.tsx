/**
 * @vitest-environment happy-dom
 */
import { act, createRef, type ReactNode, type RefObject } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ManagedPane, PaneManager } from '@/lib/pane-manager/pane-manager'
import type { PtyTransport } from './pty-transport'
import TerminalPaneHeaderOverlay from './TerminalPaneHeaderOverlay'

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children?: ReactNode }) => children,
  TooltipTrigger: ({ children }: { children?: ReactNode }) => children,
  TooltipContent: ({ children }: { children?: ReactNode }) => <span>{children}</span>
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children?: ReactNode }) => children,
  DropdownMenuTrigger: ({ children }: { children?: ReactNode }) => children,
  DropdownMenuContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onSelect }: { children?: ReactNode; onSelect?: () => void }) => (
    <button onClick={onSelect}>{children}</button>
  ),
  DropdownMenuShortcut: ({ children }: { children?: ReactNode }) => <span>{children}</span>
}))

vi.mock('@/hooks/useShortcutLabel', () => ({
  useShortcutLabel: (id: string) =>
    id === 'terminal.splitRight' ? '⌘D' : id === 'terminal.splitDown' ? '⌘⇧D' : ''
}))

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, string>) =>
    Object.entries(values ?? {}).reduce(
      (text, [key, value]) => text.replace(`{{${key}}}`, value),
      fallback
    )
}))

const mounted: { container: HTMLDivElement; root: Root }[] = []

function makePane(id: number): ManagedPane {
  const leafId = `leaf-${id}` as ManagedPane['leafId']
  return {
    id,
    leafId,
    stablePaneId: leafId,
    container: document.createElement('div'),
    linkTooltip: document.createElement('div'),
    terminal: {} as ManagedPane['terminal'],
    fitAddon: {} as ManagedPane['fitAddon'],
    searchAddon: {} as ManagedPane['searchAddon'],
    serializeAddon: {} as ManagedPane['serializeAddon']
  }
}

function renderOverlay({
  paneTitles,
  paneCount = 2,
  showAlwaysOnHeaders = true,
  showSplitButton = true,
  onSplitPane = vi.fn(),
  onClosePane = vi.fn(),
  onRemoveTitle = vi.fn(),
  onRenameSubmit = vi.fn(),
  renameValue = '',
  renamingPaneId = null
}: {
  paneTitles: Record<number, string>
  paneCount?: number
  showAlwaysOnHeaders?: boolean
  showSplitButton?: boolean
  onSplitPane?: ReturnType<typeof vi.fn>
  onClosePane?: ReturnType<typeof vi.fn>
  onRemoveTitle?: ReturnType<typeof vi.fn>
  onRenameSubmit?: ReturnType<typeof vi.fn>
  renameValue?: string
  renamingPaneId?: number | null
}): {
  container: HTMLDivElement
  onClosePane: ReturnType<typeof vi.fn>
  onRemoveTitle: ReturnType<typeof vi.fn>
  onRenameSubmit: ReturnType<typeof vi.fn>
  onSplitPane: ReturnType<typeof vi.fn>
} {
  const panes = [makePane(1), makePane(2)]
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <TerminalPaneHeaderOverlay
        tabId="tab-1"
        worktreeId="wt-1"
        cwd={path.join(path.sep, 'tmp')}
        showAlwaysOnHeaders={showAlwaysOnHeaders}
        showSplitButton={showSplitButton}
        paneCount={paneCount}
        activePaneId={1}
        panes={panes}
        paneTitles={paneTitles}
        paneTitleOverlayRects={{
          1: { left: 0, top: 0, width: 200 },
          2: { left: 220, top: 0, width: 200 }
        }}
        renamingPaneId={renamingPaneId}
        renameValue={renameValue}
        renameInputRef={createRef<HTMLInputElement>()}
        titleUsesLightSurface={false}
        paneTitleBackground="transparent"
        terminalContentVisible
        hiddenStartupStyle={{}}
        managerRef={{ current: null } as RefObject<PaneManager | null>}
        paneTransportsRef={{ current: new Map() } as RefObject<Map<number, PtyTransport>>}
        onSplitPane={
          onSplitPane as (pane: ManagedPane, direction: 'vertical' | 'horizontal') => void
        }
        onBeginPaneDrag={vi.fn()}
        onActivatePaneTitleInteraction={vi.fn()}
        onPaneTitleContextMenu={vi.fn()}
        onStartRename={vi.fn()}
        onRemoveTitle={onRemoveTitle as (paneId: number) => void}
        onClosePane={onClosePane as (paneId: number) => void}
        onRenameValueChange={vi.fn()}
        onRenameSubmit={onRenameSubmit as () => void}
        onRenameCancel={vi.fn()}
        onRenameBlur={vi.fn()}
      />
    )
  })
  mounted.push({ container, root })
  return { container, onClosePane, onRemoveTitle, onRenameSubmit, onSplitPane }
}

function pressInputKey(
  input: HTMLInputElement,
  key: string,
  options?: { isComposing?: boolean; keyCode?: number }
): void {
  act(() => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true })
    if (options?.isComposing !== undefined) {
      Object.defineProperty(event, 'isComposing', { value: options.isComposing })
    }
    if (options?.keyCode !== undefined) {
      Object.defineProperty(event, 'keyCode', { value: options.keyCode })
    }
    input.dispatchEvent(event)
  })
}

afterEach(() => {
  for (const { container, root } of mounted.splice(0)) {
    act(() => root.unmount())
    container.remove()
  }
})

describe('TerminalPaneHeaderOverlay', () => {
  it('keeps the titled-pane close affordance as remove-title while headers are always on', () => {
    const { container, onClosePane, onRemoveTitle } = renderOverlay({
      paneTitles: { 1: 'server', 2: '' }
    })

    const removeTitle = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove pane title: server"]'
    )
    expect(removeTitle).not.toBeNull()

    act(() => removeTitle?.click())

    expect(onRemoveTitle).toHaveBeenCalledWith(1)
    expect(onClosePane).not.toHaveBeenCalledWith(1)
  })

  it('keeps split and close-pane controls available for untitled split pane headers', () => {
    const { container, onClosePane, onRemoveTitle, onSplitPane } = renderOverlay({
      paneTitles: { 1: '', 2: '' }
    })

    expect(container.querySelector('button[aria-label="Split terminal"]')).not.toBeNull()
    const splitRight = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      button.textContent?.includes('Split terminal right')
    )
    const splitDown = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      button.textContent?.includes('Split terminal down')
    )
    expect(splitRight?.textContent).toContain('⌘D')
    expect(splitDown?.textContent).toContain('⌘⇧D')
    act(() => splitRight?.click())
    act(() => splitDown?.click())
    expect(onSplitPane).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: 1 }), 'vertical')
    expect(onSplitPane).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: 1 }), 'horizontal')
    expect(container.querySelector('.pane-title-drag-handle')).toBeNull()
    const closePane = container.querySelector<HTMLButtonElement>('button[aria-label="Close Pane"]')
    expect(closePane).not.toBeNull()

    act(() => closePane?.click())

    expect(onClosePane).toHaveBeenCalledWith(1)
    expect(onRemoveTitle).not.toHaveBeenCalled()
  })

  it('omits the split control when the header affordance is hidden', () => {
    const { container } = renderOverlay({
      paneTitles: { 1: '', 2: '' },
      paneCount: 1,
      showSplitButton: false
    })

    expect(container.querySelector('button[aria-label="Split terminal"]')).toBeNull()
  })

  it('keeps pane controls visible on hover-none touch surfaces', () => {
    const css = readFileSync(
      path.join(process.cwd(), 'src/renderer/src/assets/terminal.css'),
      'utf8'
    )
    expect(css).toContain('@media (hover: none)')
    expect(css).toMatch(/\.pane-title-split-trigger,\s*\.pane-title-close\s*\{\s*opacity:\s*1;/)
  })

  it('ignores IME composition Enter before submitting a pane title rename', () => {
    const { container, onRenameSubmit } = renderOverlay({
      paneTitles: { 1: 'server', 2: '' },
      renamingPaneId: 1,
      renameValue: '日本語 pane'
    })
    const input = container.querySelector<HTMLInputElement>('.pane-title-input')

    expect(input).not.toBeNull()

    pressInputKey(input as HTMLInputElement, 'Enter', { isComposing: true })

    expect(onRenameSubmit).not.toHaveBeenCalled()

    pressInputKey(input as HTMLInputElement, 'Enter')

    expect(onRenameSubmit).toHaveBeenCalledTimes(1)
  })
})

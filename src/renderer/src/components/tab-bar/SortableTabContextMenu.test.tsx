/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from 'vitest'
import { REQUEST_ACTIVE_TERMINAL_PANE_SPLIT_EVENT } from '@/constants/terminal'
import { requestActiveTerminalPaneSplit } from './request-active-terminal-pane-split'

vi.mock('@/hooks/useShortcutLabel', () => ({
  formatShortcutLabel: () => '⌘D'
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children?: unknown }) => children,
  DropdownMenuContent: ({ children }: { children?: unknown }) => children,
  DropdownMenuItem: ({ children }: { children?: unknown }) => children,
  DropdownMenuLabel: ({ children }: { children?: unknown }) => children,
  DropdownMenuSeparator: () => null,
  DropdownMenuShortcut: ({ children }: { children?: unknown }) => children,
  DropdownMenuTrigger: ({ children }: { children?: unknown }) => children
}))

vi.mock('lucide-react', () => ({
  PanelBottomClose: () => null,
  PanelRightClose: () => null,
  Pin: () => null,
  PinOff: () => null
}))

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

vi.mock('./TabWorkspaceLayoutMenuSection', () => ({
  TabWorkspaceLayoutMenuSection: () => null
}))

vi.mock('../../store', () => ({
  useAppStore: (selector: (state: { keybindings: Record<string, unknown> }) => unknown) =>
    selector({ keybindings: {} })
}))

describe('requestActiveTerminalPaneSplit', () => {
  it('dispatches the active terminal pane split event', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

    requestActiveTerminalPaneSplit({ tabId: 'term-1', direction: 'vertical' })

    expect(dispatchSpy).toHaveBeenCalledTimes(1)
    const event = dispatchSpy.mock.calls[0]?.[0] as CustomEvent
    expect(event.type).toBe(REQUEST_ACTIVE_TERMINAL_PANE_SPLIT_EVENT)
    expect(event.detail).toEqual({
      tabId: 'term-1',
      direction: 'vertical'
    })

    dispatchSpy.mockRestore()
  })
})

describe('SortableTabContextMenu', () => {
  it('renders without throwing when shortcut labels are resolved', async () => {
    const { SortableTabContextMenu } = await import('./SortableTabContextMenu')

    expect(() =>
      SortableTabContextMenu({
        tab: {
          id: 'term-1',
          title: 'bash',
          customTitle: null,
          type: 'terminal',
          worktreeId: 'wt-1',
          createdAt: 0
        },
        unifiedTabId: 'term-1',
        groupId: 'group-1',
        isActive: true,
        open: true,
        point: { x: 0, y: 0 },
        tabCount: 1,
        hasTabsToRight: false,
        isPinned: false,
        onOpenChange: vi.fn(),
        onActivate: vi.fn(),
        onClose: vi.fn(),
        onCloseOthers: vi.fn(),
        onCloseToRight: vi.fn(),
        onSetCustomTitle: vi.fn(),
        onSetTabColor: vi.fn(),
        onTogglePin: vi.fn()
      })
    ).not.toThrow()
  })
})

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  loadDefaultSessionView,
  loadSessionViewOverrides,
  saveSessionViewOverrides,
  type MobileSessionView
} from '../storage/preferences'
import {
  useMobileSessionViewMode,
  type MobileSessionViewModeController
} from './use-mobile-session-view-mode'

vi.mock('expo-router', async () => {
  const react = await import('react')
  return {
    // Run the focus callback once on mount, mirroring a focus.
    useFocusEffect: (cb: () => undefined | (() => void)) => react.useEffect(() => cb(), [cb])
  }
})

vi.mock('../storage/preferences', () => ({
  loadDefaultSessionView: vi.fn(),
  loadSessionViewOverrides: vi.fn(),
  saveSessionViewOverrides: vi.fn()
}))

describe('useMobileSessionViewMode', () => {
  let renderer: ReactTestRenderer | null = null
  let controller: MobileSessionViewModeController | null = null

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    vi.mocked(loadDefaultSessionView).mockResolvedValue('terminal')
    vi.mocked(loadSessionViewOverrides).mockResolvedValue(new Map())
    vi.mocked(saveSessionViewOverrides).mockReset().mockResolvedValue(undefined)
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    controller = null
  })

  async function mount(args: {
    defaultView: MobileSessionView
    overrides?: Map<string, MobileSessionView>
  }): Promise<void> {
    vi.mocked(loadDefaultSessionView).mockResolvedValue(args.defaultView)
    vi.mocked(loadSessionViewOverrides).mockResolvedValue(args.overrides ?? new Map())
    function Harness(): null {
      controller = useMobileSessionViewMode({ hostId: 'h', worktreeId: 'w' })
      return null
    }
    await act(async () => {
      renderer = create(createElement(Harness))
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  it('follows the default when a tab has no override', async () => {
    await mount({ defaultView: 'terminal' })
    expect(controller?.isTabChatView('t1')).toBe(false)

    act(() => renderer?.unmount())
    renderer = null
    await mount({ defaultView: 'chat' })
    expect(controller?.isTabChatView('t1')).toBe(true)
  })

  it('lets a per-tab override win over the default', async () => {
    await mount({
      defaultView: 'chat',
      overrides: new Map<string, MobileSessionView>([['t1', 'terminal']])
    })
    expect(controller?.isTabChatView('t1')).toBe(false)
    expect(controller?.isTabChatView('t2')).toBe(true)
  })

  it('toggles from the effective view and persists the override', async () => {
    await mount({ defaultView: 'chat' })

    await act(async () => {
      controller?.toggleTabChatView('t1')
      await Promise.resolve()
    })

    const call = vi.mocked(saveSessionViewOverrides).mock.calls.at(-1)
    expect(call?.[0]).toBe('h')
    expect(call?.[1]).toBe('w')
    expect(call?.[2].get('t1')).toBe('terminal')
    expect(controller?.isTabChatView('t1')).toBe(false)
  })

  it('toggles a terminal-default tab into chat', async () => {
    await mount({ defaultView: 'terminal' })

    await act(async () => {
      controller?.toggleTabChatView('t1')
      await Promise.resolve()
    })

    expect(vi.mocked(saveSessionViewOverrides).mock.calls.at(-1)?.[2].get('t1')).toBe('chat')
    expect(controller?.isTabChatView('t1')).toBe(true)
  })
})

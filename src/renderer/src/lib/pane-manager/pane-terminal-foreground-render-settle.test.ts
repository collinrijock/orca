import { describe, expect, it, vi } from 'vitest'
import { writeForegroundTerminalChunk } from './pane-terminal-foreground-render-settle'

// Field bug class (v1.4.144 blank reveal): a cold-park remount replays the
// daemon snapshot into a brand-new xterm whose RenderService can still be
// paused (its IntersectionObserver lags the reveal by a frame, worse under
// load). While paused, xterm swallows refresh()/refreshRows() — the replay
// parses into the buffer but never paints, and the remount path has no
// reveal-repaint to recover it. The settle refresh must therefore drive one
// synchronous render through the pause latch itself.

type RefreshFn = (start: number, end: number, sync?: boolean) => void

type RenderServiceStub = {
  _isPaused: boolean
  _needsFullRefresh: boolean
  refreshRows: ReturnType<typeof vi.fn<RefreshFn>>
}

function createTerminal(paused: boolean): {
  terminal: {
    rows: number
    buffer: { active: { cursorY: number; baseY: number; viewportY: number } }
    _core: { refresh: ReturnType<typeof vi.fn<RefreshFn>>; _renderService: RenderServiceStub }
    refresh: ReturnType<typeof vi.fn<(start: number, end: number) => void>>
    write: (data: string, callback?: () => void) => void
  }
  renderService: RenderServiceStub
} {
  const renderService: RenderServiceStub = {
    _isPaused: paused,
    _needsFullRefresh: paused,
    refreshRows: vi.fn<RefreshFn>()
  }
  const terminal = {
    rows: 24,
    buffer: { active: { cursorY: 0, baseY: 0, viewportY: 0 } },
    _core: { refresh: vi.fn<RefreshFn>(), _renderService: renderService },
    refresh: vi.fn<(start: number, end: number) => void>(),
    write: (_data: string, callback?: () => void) => {
      callback?.()
    }
  }
  return { terminal, renderService }
}

describe('writeForegroundTerminalChunk under a paused RenderService', () => {
  it('drives a synchronous full render through the pause latch', () => {
    const { terminal, renderService } = createTerminal(true)

    writeForegroundTerminalChunk(terminal, 'replayed snapshot bytes', {
      forceViewportRefresh: true
    })

    expect(renderService.refreshRows).toHaveBeenCalledWith(0, 23, true)
    expect(renderService._isPaused).toBe(false)
    expect(renderService._needsFullRefresh).toBe(false)
  })

  it('keeps the ordinary refresh path when the renderer is not paused', () => {
    const { terminal, renderService } = createTerminal(false)

    writeForegroundTerminalChunk(terminal, 'live bytes', {
      forceViewportRefresh: true
    })

    expect(renderService.refreshRows).not.toHaveBeenCalled()
    expect(terminal._core.refresh).toHaveBeenCalledWith(0, 23, true)
  })
})

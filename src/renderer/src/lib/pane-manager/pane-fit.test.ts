import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ManagedPane, ScrollState } from './pane-manager-types'
import { safeFit, safeFitAndThen } from './pane-fit'

// Field bug class (v1.4.144 blank/gap reveal): the reattach/hidden-snapshot
// replay defers its corrective PTY resize into a safeFitAndThen continuation.
// When the pane is momentarily unmeasurable at that instant (mid-reveal
// layout), the immediate fit fails and the continuation used to wait for the
// NEXT coincidental successful fit — which may never come (no further
// ResizeObserver events once the container size settles). The pane then stays
// at snapshot dims with no PTY resize/SIGWINCH until a manual window resize.
// These tests pin the desired behavior: a parked continuation is actively
// retried once the pane becomes measurable, without any external fit call.

let nextRafId = 1
let pendingRafs = new Map<number, FrameRequestCallback>()

function flushAnimationFrames(timestamp = 16): void {
  const callbacks = Array.from(pendingRafs.entries())
  pendingRafs = new Map()
  for (const [, callback] of callbacks) {
    callback(timestamp)
  }
}

function createPane(options: {
  rect: { width: number; height: number }
  proposed?: () => { cols: number; rows: number } | undefined
}): ManagedPane & { setRect: (rect: { width: number; height: number }) => void } {
  let rect = options.rect
  const leafId = '22222222-2222-4222-8222-222222222222'
  const pane = {
    id: 7,
    leafId,
    stablePaneId: leafId,
    terminal: {
      cols: 80,
      rows: 24
    },
    container: {
      dataset: {},
      getBoundingClientRect: () => ({ width: rect.width, height: rect.height })
    },
    xtermContainer: {
      getBoundingClientRect: () => ({ width: rect.width, height: rect.height })
    },
    fitAddon: {
      fit: vi.fn(),
      proposeDimensions: vi.fn(options.proposed ?? (() => ({ cols: 132, rows: 40 })))
    },
    serializeAddon: {},
    searchAddon: {},
    pendingSplitScrollState: null as ScrollState | null,
    setRect: (next: { width: number; height: number }) => {
      rect = next
    }
  }
  return pane as unknown as ManagedPane & {
    setRect: (rect: { width: number; height: number }) => void
  }
}

describe('safeFitAndThen unmeasurable-pane retry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    nextRafId = 1
    pendingRafs = new Map()
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        const id = nextRafId++
        pendingRafs.set(id, callback)
        return id
      })
    )
    vi.stubGlobal(
      'cancelAnimationFrame',
      vi.fn((id: number) => {
        pendingRafs.delete(id)
      })
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('runs the continuation once the pane becomes measurable, without an external fit', async () => {
    const pane = createPane({ rect: { width: 0, height: 0 } })
    const continuation = vi.fn()

    const handle = safeFitAndThen(pane, 'reattach-pty-resize', continuation)
    expect(continuation).not.toHaveBeenCalled()

    // The pane lays out a few frames later; no ResizeObserver event follows
    // because the container size never changes again.
    pane.setRect({ width: 800, height: 600 })
    for (let frame = 0; frame < 12 && continuation.mock.calls.length === 0; frame += 1) {
      flushAnimationFrames()
      vi.advanceTimersByTime(50)
    }

    expect(continuation).toHaveBeenCalledTimes(1)
    await expect(handle.completion).resolves.toBe(true)
  })

  it('stops retrying once cancelled', () => {
    const pane = createPane({ rect: { width: 0, height: 0 } })
    const continuation = vi.fn()

    const handle = safeFitAndThen(pane, 'reattach-pty-resize', continuation)
    handle.cancel()
    pane.setRect({ width: 800, height: 600 })
    for (let frame = 0; frame < 12; frame += 1) {
      flushAnimationFrames()
      vi.advanceTimersByTime(50)
    }

    expect(continuation).not.toHaveBeenCalled()
  })

  it('does not retry when shouldContinue reports the restore is stale', () => {
    const pane = createPane({ rect: { width: 0, height: 0 } })
    const continuation = vi.fn()
    let current = true

    safeFitAndThen(pane, 'reattach-pty-resize', continuation, {
      shouldContinue: () => current
    })
    current = false
    pane.setRect({ width: 800, height: 600 })
    for (let frame = 0; frame < 12; frame += 1) {
      flushAnimationFrames()
      vi.advanceTimersByTime(50)
    }

    expect(continuation).not.toHaveBeenCalled()
  })

  it('still flushes through an ordinary external fit (existing contract)', () => {
    const pane = createPane({ rect: { width: 0, height: 0 } })
    const continuation = vi.fn()

    safeFitAndThen(pane, 'reattach-pty-resize', continuation)
    pane.setRect({ width: 800, height: 600 })
    safeFit(pane)

    expect(continuation).toHaveBeenCalledTimes(1)
  })
})

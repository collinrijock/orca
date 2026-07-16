// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { WorkingRing, WorkingRingOffscreenContext } from './WorkingRing'
import StatusIndicator from './sidebar/StatusIndicator'
import { AgentStateDot } from './AgentStateDot'

// --- controllable environment -------------------------------------------------

const timeline = { currentTime: 0 }

function setClock(ms: number): void {
  timeline.currentTime = ms
}

function setReducedMotion(matches: boolean): void {
  window.matchMedia = vi.fn((query: string) => {
    const isReduced = query.includes('prefers-reduced-motion')
    return {
      matches: isReduced ? matches : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null
    } as unknown as MediaQueryList
  })
}

let visibilityState: DocumentVisibilityState = 'visible'

function setDocumentVisible(visible: boolean): void {
  visibilityState = visible ? 'visible' : 'hidden'
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

beforeEach(() => {
  setClock(0)
  setReducedMotion(false)
  visibilityState = 'visible'
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibilityState
  })
  Object.defineProperty(document, 'timeline', {
    configurable: true,
    get: () => timeline
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** The animated ring element rendered by WorkingRing. */
function ring(container: HTMLElement): HTMLElement {
  const element = container.querySelector<HTMLElement>('.border-yellow-500')
  if (!element) {
    throw new Error('working ring not found')
  }
  return element
}

function isAnimating(container: HTMLElement): boolean {
  return ring(container).classList.contains('working-ring-spin')
}

// --- tests --------------------------------------------------------------------

describe('WorkingRing', () => {
  it('animates when visible, motion allowed, and onscreen', () => {
    setClock(1250)
    const { container } = render(<WorkingRing className="size-2" />)

    expect(isAnimating(container)).toBe(true)
    // Anchored to the shared timeline origin: 1250 → -(1250 % 1000) = -250ms.
    expect(ring(container).style.animationDelay).toBe('-250ms')
  })

  it('stays static under reduced motion', () => {
    setReducedMotion(true)
    const { container } = render(<WorkingRing className="size-2" />)

    expect(isAnimating(container)).toBe(false)
    expect(ring(container).style.animationDelay).toBe('')
  })

  it('pauses when parked as virtualizer overscan (offscreen context)', () => {
    const { container } = render(
      <WorkingRingOffscreenContext.Provider value={true}>
        <WorkingRing className="size-2" />
      </WorkingRingOffscreenContext.Provider>
    )

    expect(isAnimating(container)).toBe(false)
  })

  it('keeps animating a visible ring in an onscreen context', () => {
    const { container } = render(
      <WorkingRingOffscreenContext.Provider value={false}>
        <WorkingRing className="size-2" />
      </WorkingRingOffscreenContext.Provider>
    )

    expect(isAnimating(container)).toBe(true)
  })

  it('pauses on document hidden and resumes at the shared phase on restore', () => {
    setClock(1250)
    const { container } = render(<WorkingRing className="size-2" />)
    expect(isAnimating(container)).toBe(true)

    setDocumentVisible(false)
    expect(isAnimating(container)).toBe(false)
    expect(ring(container).style.animationDelay).toBe('')

    // Time advanced while hidden; on restore the ring re-anchors to the shared
    // origin rather than resuming its pre-hide position.
    setClock(1600)
    setDocumentVisible(true)
    expect(isAnimating(container)).toBe(true)
    expect(ring(container).style.animationDelay).toBe('-600ms')
  })

  it('phase-locks independently rendered rings to one delay', () => {
    setClock(1734)
    const { container } = render(
      <div>
        <WorkingRing className="size-2" />
        <WorkingRing className="size-2" />
      </div>
    )

    const rings = container.querySelectorAll<HTMLElement>('.border-yellow-500')
    expect(rings).toHaveLength(2)
    expect(rings[0]!.style.animationDelay).toBe('-734ms')
    // Same shared clock → same anchor → same frames.
    expect(rings[1]!.style.animationDelay).toBe(rings[0]!.style.animationDelay)
  })

  it('introduces no recurring timer or animation-frame loop', () => {
    const setInterval = vi.spyOn(globalThis, 'setInterval')
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame')

    const { container } = render(<WorkingRing className="size-2" />)
    setInterval.mockClear()
    raf.mockClear()

    // Toggle visibility a few times — the only reaction is event-driven state.
    setDocumentVisible(false)
    setDocumentVisible(true)
    setDocumentVisible(false)
    expect(isAnimating(container)).toBe(false)

    expect(setInterval).not.toHaveBeenCalled()
    expect(raf).not.toHaveBeenCalled()
  })
})

describe('reduced motion disables both indicators', () => {
  it('stops the aggregate StatusIndicator and per-agent AgentStateDot', () => {
    setReducedMotion(true)
    const { container } = render(
      <div>
        <StatusIndicator status="working" />
        <AgentStateDot state="working" />
      </div>
    )

    const rings = container.querySelectorAll<HTMLElement>('.border-yellow-500')
    expect(rings).toHaveLength(2)
    for (const element of rings) {
      expect(element.classList.contains('working-ring-spin')).toBe(false)
    }
  })
})

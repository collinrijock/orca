import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../../../shared/types'

// Why: run the hook's effect synchronously by stubbing React.useEffect so its
// keydown/keyup listeners register on our event-target stubs without a renderer.
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return { ...actual, useEffect: (effect: () => void | (() => void)) => effect() }
})

// Imported after the mock so the hook closes over the synchronous useEffect.
const { useHoldDictationGesture } = await import('./use-hold-dictation-gesture')

// Why: the project's vitest runs in the node environment and happy-dom is not
// available in this checkout, so we drive the hook's window/document keyup
// listeners through a minimal event-target stub instead of a real DOM. The hook
// only uses addEventListener/removeEventListener and a KeyboardEvent-like shape.

type Listener = (event: KeyboardEventLike) => void

type KeyboardEventLike = {
  type: string
  key?: string
  code?: string
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  preventDefault: () => void
  stopPropagation: () => void
}

class FakeEventTarget {
  listeners = new Map<string, Set<Listener>>()

  addEventListener(type: string, listener: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>()
    set.add(listener)
    this.listeners.set(type, set)
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener)
  }

  dispatch(event: KeyboardEventLike): void {
    for (const listener of this.listeners.get(event.type) ?? []) {
      listener(event)
    }
  }
}

function keyEvent(type: string, init: Partial<KeyboardEventLike>): KeyboardEventLike {
  return {
    type,
    preventDefault: () => {},
    stopPropagation: () => {},
    ...init
  }
}

let fakeWindow: FakeEventTarget
let fakeDocument: FakeEventTarget & { visibilityState: string }

function runHook(options: Parameters<typeof useHoldDictationGesture>[0]): void {
  useHoldDictationGesture(options)
}

beforeEach(() => {
  fakeWindow = new FakeEventTarget()
  fakeDocument = Object.assign(new FakeEventTarget(), { visibilityState: 'visible' })
  vi.stubGlobal('window', fakeWindow)
  vi.stubGlobal('document', fakeDocument)
  vi.stubGlobal('navigator', { userAgent: 'Linux X11' })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function holdSettings(): GlobalSettings {
  return {
    voice: { dictationMode: 'hold', enabled: true, sttModel: 'tiny' }
  } as unknown as GlobalSettings
}

describe('useHoldDictationGesture modifier-first release', () => {
  it('stops dictation when the modifier is released before the main key', () => {
    const stopDictation = vi.fn()
    const startDictation = vi.fn()
    const dictationState = { current: 'idle' as string }
    const holdActive = { current: false }

    runHook({
      dictationStateRef: dictationState as never,
      holdGestureActiveRef: holdActive,
      insertionTargetRef: { current: null },
      intentionalTargetCancellationRef: { current: false },
      keybindings: {},
      settings: holdSettings(),
      startDictation,
      stopDictation
    })

    // Press the chord (Mod+E → Ctrl+E on Linux): starts the hold gesture.
    fakeWindow.dispatch(keyEvent('keydown', { key: 'e', code: 'KeyE', ctrlKey: true }))
    expect(startDictation).toHaveBeenCalledTimes(1)
    expect(holdActive.current).toBe(true)
    dictationState.current = 'listening'

    // Release Ctrl first while E is still held: the keyup reports key 'Control'
    // with ctrlKey=false, so it no longer matches the full Ctrl+E chord.
    fakeWindow.dispatch(keyEvent('keyup', { key: 'Control', code: 'ControlLeft' }))

    expect(stopDictation).toHaveBeenCalledTimes(1)
    expect(holdActive.current).toBe(false)
  })

  it('still stops on a normal main-key release', () => {
    const stopDictation = vi.fn()
    const dictationState = { current: 'listening' as string }
    const holdActive = { current: true }

    runHook({
      dictationStateRef: dictationState as never,
      holdGestureActiveRef: holdActive,
      insertionTargetRef: { current: null },
      intentionalTargetCancellationRef: { current: false },
      keybindings: {},
      settings: holdSettings(),
      startDictation: vi.fn(),
      stopDictation
    })

    // Full chord still down on keyup (key E, ctrl held): matches and stops.
    fakeWindow.dispatch(keyEvent('keyup', { key: 'e', code: 'KeyE', ctrlKey: true }))

    expect(stopDictation).toHaveBeenCalledTimes(1)
    expect(holdActive.current).toBe(false)
  })
})

import type { IDisposable } from '@xterm/xterm'
import {
  bindTerminalScrollIntentKey,
  markTerminalPinnedViewport,
  syncTerminalScrollIntentFromViewport,
  syncTerminalScrollIntentSoon
} from './terminal-scroll-intent'
import type { TerminalScrollIntentKey, TerminalScrollIntentTarget } from './terminal-scroll-intent'

const XTERM_SCROLL_INTENT_POINTER_TARGET_CLASSES = [
  'xterm-viewport',
  'xterm-scrollbar',
  'xterm-slider'
] as const
const XTERM_SCROLL_INTENT_POINTER_TARGET_SELECTOR = XTERM_SCROLL_INTENT_POINTER_TARGET_CLASSES.map(
  (className) => `.${className}`
).join(',')

function isTerminalScrollIntentPointerTarget(target: EventTarget | null): target is Element {
  if (typeof Element === 'undefined' || !(target instanceof Element)) {
    return false
  }
  // xterm's custom scrollbar uses separate thumb/track nodes from the viewport.
  return target.closest(XTERM_SCROLL_INTENT_POINTER_TARGET_SELECTOR) !== null
}

/** Wires the user-driven scroll signals (wheel, scrollbar pointer drags) that
 *  are allowed to change a terminal's scroll intent. Output-driven scroll
 *  events deliberately do not update intent (see terminal-scroll-intent.ts). */
export function attachTerminalScrollIntentTracking(
  terminal: TerminalScrollIntentTarget,
  host: HTMLElement,
  intentKey?: TerminalScrollIntentKey
): IDisposable {
  if (!bindTerminalScrollIntentKey(terminal, intentKey)) {
    syncTerminalScrollIntentFromViewport(terminal)
  }
  let pointerScrollActive = false

  const onWheel = (event: WheelEvent): void => {
    if (event.deltaY < 0) {
      markTerminalPinnedViewport(terminal)
      syncTerminalScrollIntentSoon(terminal, { preservePinnedAtBottom: true })
      return
    }
    syncTerminalScrollIntentSoon(terminal)
  }

  const onPointerDown = (event: PointerEvent): void => {
    pointerScrollActive = isTerminalScrollIntentPointerTarget(event.target)
  }

  const onPointerDone = (): void => {
    if (!pointerScrollActive) {
      return
    }
    pointerScrollActive = false
    syncTerminalScrollIntentFromViewport(terminal)
  }

  const onScroll = (): void => {
    if (pointerScrollActive) {
      syncTerminalScrollIntentFromViewport(terminal)
    }
  }

  host.addEventListener('wheel', onWheel, { capture: true, passive: true })
  host.addEventListener('pointerdown', onPointerDown, true)
  host.addEventListener('scroll', onScroll, true)
  globalThis.addEventListener?.('pointerup', onPointerDone, true)
  globalThis.addEventListener?.('pointercancel', onPointerDone, true)
  return {
    dispose: () => {
      host.removeEventListener('wheel', onWheel, true)
      host.removeEventListener('pointerdown', onPointerDown, true)
      host.removeEventListener('scroll', onScroll, true)
      globalThis.removeEventListener?.('pointerup', onPointerDone, true)
      globalThis.removeEventListener?.('pointercancel', onPointerDone, true)
    }
  }
}

// Shared cadence for every visible "working" spinner (aggregate worktree
// StatusIndicator, per-agent AgentStateDot, terminal tabs). Keeping one period
// and step count in a single module is what lets independently mounted rings
// phase-lock onto the same frames instead of each drifting to its own phase.

/** One full rotation per second — the visible working affordance. */
export const WORKING_RING_PERIOD_MS = 1000

/** 12 discrete steps per second. Do not lower without profiler evidence. */
export const WORKING_RING_STEP_COUNT = 12

/**
 * Negative `animation-delay` that re-anchors a freshly applied stepped rotation
 * to the document timeline's origin. Because every ring's virtual start becomes
 * `now - (now % period)` — always a multiple of the period — all rings share
 * one phase regardless of when they mount, so their 12 steps land on the same
 * frames. This reads the shared clock exactly once per call; there is no
 * recurring JS clock driving the animation.
 */
export function sharedStepPhaseDelayMs(nowMs?: number): number {
  const now = nowMs ?? readSharedClockMs()
  const phase = ((now % WORKING_RING_PERIOD_MS) + WORKING_RING_PERIOD_MS) % WORKING_RING_PERIOD_MS
  // `|| 0` normalizes -0 (on a period boundary) to +0.
  return -phase || 0
}

/**
 * The clock CSS animations are anchored to. Prefer `document.timeline`, which
 * is the exact reference the compositor uses for CSS animation start times, and
 * fall back to `performance.now()` (tests / SSR) so the helper stays pure and
 * host-neutral.
 */
function readSharedClockMs(): number {
  if (typeof document !== 'undefined' && typeof document.timeline?.currentTime === 'number') {
    return document.timeline.currentTime
  }
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return 0
}

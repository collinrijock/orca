import { describe, expect, it } from 'vitest'
import {
  sharedStepPhaseDelayMs,
  WORKING_RING_PERIOD_MS,
  WORKING_RING_STEP_COUNT
} from './working-ring-phase'

describe('sharedStepPhaseDelayMs', () => {
  it('keeps 12 steps per second', () => {
    // Guard the cadence contract: this change must not lower the step count.
    expect(WORKING_RING_PERIOD_MS).toBe(1000)
    expect(WORKING_RING_STEP_COUNT).toBe(12)
  })

  it('returns a delay within one period, in (-period, 0]', () => {
    for (const now of [0, 1, 250, 999, 1000, 1234.5, 987654]) {
      const delay = sharedStepPhaseDelayMs(now)
      expect(delay).toBeLessThanOrEqual(0)
      expect(delay).toBeGreaterThan(-WORKING_RING_PERIOD_MS)
    }
  })

  it('anchors every mount time to the same origin grid (phase-lock)', () => {
    // The whole point: a ring applied at `now` behaves as if it started at
    // `now + delay`, which must be a multiple of the period for all `now`, so
    // rings mounted at different times share one phase.
    for (const now of [0, 83.3, 250, 750, 1000.4, 1999, 5123.7]) {
      const virtualStart = now + sharedStepPhaseDelayMs(now)
      expect(virtualStart % WORKING_RING_PERIOD_MS).toBeCloseTo(0, 6)
    }
  })

  it('gives a zero delay exactly on a period boundary', () => {
    expect(sharedStepPhaseDelayMs(0)).toBe(0)
    expect(sharedStepPhaseDelayMs(WORKING_RING_PERIOD_MS)).toBe(0)
    expect(sharedStepPhaseDelayMs(3 * WORKING_RING_PERIOD_MS)).toBe(0)
  })

  it('two rings reading the same clock get identical delays', () => {
    const now = 1734.2
    expect(sharedStepPhaseDelayMs(now)).toBe(sharedStepPhaseDelayMs(now))
  })
})

import { describe, expect, it, vi } from 'vitest'

import { measurePastePayloadMetadataWithYield } from '../../lib/paste-payload-metadata'
import {
  executeTerminalPastePlan,
  planTerminalPasteWithYield,
  type TerminalPasteTarget
} from './terminal-paste-coordinator'

// Repro harness for issue #5919 ("Pasting 200+ lines hangs Orca 20+ seconds").
//
// VERDICT: NOT REPRODUCED on the current tree.
//
// The report predates the terminal paste coordinator (landed 2026-06-19, one day
// before the Discord report on 2026-06-20). The old paste path handed the whole
// clipboard blob to xterm synchronously on the main thread. The current tree routes
// every interactive paste (TerminalPane.tsx ~L2104/2125) through
// planTerminalPasteWithYield -> executeTerminalPastePlan, which:
//   1. measures payload metadata cooperatively (yields to the event loop), and
//   2. writes large payloads as bounded UTF-8 chunks, yielding between each write.
//
// These tests IMPORT THE REAL product modules and pin that non-blocking contract.
// If a future change reintroduced synchronous whole-blob handling, they would fail.

function terminalTarget(overrides: Partial<TerminalPasteTarget> = {}): TerminalPasteTarget {
  return {
    kind: 'terminal',
    paneId: 1,
    leafId: 'leaf-1',
    ptyId: 'pty-1',
    runtime: {
      platform: 'darwin',
      runtimeKey: 'local:darwin',
      kind: 'local'
    },
    ...overrides
  }
}

// A realistic "200+ lines" clipboard payload (the exact scenario in the report).
function buildLinesPayload(lineCount: number, columns = 60): string {
  return Array.from({ length: lineCount }, (_value, index) =>
    `${String(index).padStart(4, '0')}: ${'x'.repeat(columns)}`
  ).join('\n')
}

describe('issue #5919 large paste is non-blocking (NOT REPRODUCED)', () => {
  it('measures a 200+ line payload without a synchronous blocking scan', async () => {
    const text = buildLinesPayload(400)
    const yieldToEventLoop = vi.fn().mockResolvedValue(undefined)

    const metadata = await measurePastePayloadMetadataWithYield(text, {
      // Force a yield boundary well inside the payload so we can observe cooperative
      // scheduling on a payload this size.
      yieldAfterCodeUnits: 1024,
      yieldToEventLoop
    })

    expect(metadata.lineCount).toBe(400)
    // FIXED-behavior assertion: the metadata scan releases the main thread instead of
    // busy-looping over the whole blob. The old (buggy) path never yielded.
    expect(yieldToEventLoop.mock.calls.length).toBeGreaterThan(1)
  })

  it('chunks a large paste and yields to the event loop between every PTY write', async () => {
    // >64KB forces the coordinator into 'chunked' mode (TERMINAL_PASTE_DIRECT_MAX_BYTES).
    const text = buildLinesPayload(2000, 40)
    expect(text.length).toBeGreaterThan(64 * 1024)

    const plan = await planTerminalPasteWithYield({
      text,
      source: 'paste-event',
      target: terminalTarget()
    })

    // FIXED-behavior assertion: the whole blob is NOT sent to xterm in one blocking call.
    expect(plan.mode).toBe('chunked')

    const writePty = vi.fn().mockReturnValue(true)
    const yieldToEventLoop = vi.fn().mockResolvedValue(undefined)

    const execution = await executeTerminalPastePlan(plan, {
      pasteText: () => {
        throw new Error('chunked plans must not fall back to the blocking whole-blob paste path')
      },
      writePty,
      yieldToEventLoop
    })

    expect(execution.status).toBe('pasted')
    // Many bounded writes, not one giant synchronous write.
    expect(writePty.mock.calls.length).toBeGreaterThan(4)
    // FIXED-behavior assertion: the executor cooperatively yields between chunks, so a
    // large paste can never freeze the UI thread the way #5919 described.
    expect(yieldToEventLoop.mock.calls.length).toBe(writePty.mock.calls.length)
  })
})

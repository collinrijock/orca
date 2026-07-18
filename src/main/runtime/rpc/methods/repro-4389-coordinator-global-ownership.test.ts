/**
 * Repro for issue #4389 — "Multiple orchestrators in a single workspace kill each other".
 *
 * Root cause: orchestration ownership is module-global, not scoped per worktree.
 * - `orchestration.run` gates on `db.getActiveCoordinatorRun()`, a query that has NO
 *   worktree predicate (SELECT ... WHERE status = 'running' ... LIMIT 1). Starting a
 *   second coordinator for a *different* worktree therefore trips "already running".
 * - The active coordinator is held in a single module-global (`activeCoordinator`), and
 *   `orchestration.runStop` takes NO worktree param (RunStopParams = z.object({})). A stop
 *   issued from coordinator B's scope resolves to A's global run and stops it.
 *
 * This test IMPORTS THE REAL handlers (ORCHESTRATION_GATE_METHODS) and the REAL
 * OrchestrationDb. Only the Coordinator's background loop is stubbed so the
 * fire-and-forget executeLoop cannot self-complete and race the assertions — the
 * ownership logic under test lives entirely in orchestration-gates.ts + db.ts.
 *
 * The assertions PIN THE BUGGY behavior: the test PASSES today while asserting the
 * WRONG result. Comments mark what the correct (worktree-scoped) behavior would be.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

// Stub the Coordinator background loop: keep runFromExistingRun pending forever so the
// DB run stays 'running' (deterministic), and record stop() so we can see which
// coordinator a scoped stop actually targets. The buggy code under test is untouched.
const stopCalls: string[] = []
vi.mock('../../orchestration/coordinator', () => ({
  Coordinator: class {
    public readonly worktree: string | undefined
    constructor(_db: unknown, _runtime: unknown, options: { worktree?: string }) {
      this.worktree = options.worktree
    }
    runFromExistingRun(): Promise<never> {
      // never resolves — mirrors a real coordinator polling worker terminals that
      // never complete, so the run remains active across subsequent RPC calls.
      return new Promise<never>(() => {})
    }
    stop(): void {
      stopCalls.push(this.worktree ?? '<none>')
    }
  }
}))

// eslint-disable-next-line import/first -- must be imported after vi.mock hoist target above.
import { ORCHESTRATION_GATE_METHODS } from './orchestration-gates'
// eslint-disable-next-line import/first
import { OrchestrationDb } from '../../orchestration/db'
// eslint-disable-next-line import/first
import { OrcaRuntimeService } from '../../orca-runtime'
// eslint-disable-next-line import/first
import type { RpcContext } from '../core'

describe('issue #4389 — coordinator ownership is module-global, not worktree-scoped', () => {
  let db: OrchestrationDb
  let ctx: RpcContext

  function findMethod(name: string) {
    const method = ORCHESTRATION_GATE_METHODS.find((m) => m.name === name)
    if (!method) {
      throw new Error(`Method not found: ${name}`)
    }
    return method
  }

  function call(name: string, params: Record<string, unknown>) {
    const method = findMethod(name)
    const parsed = method.params ? method.params.parse(params) : undefined
    return method.handler(parsed, ctx)
  }

  function setup(): void {
    stopCalls.length = 0
    db = new OrchestrationDb(':memory:')
    const runtime = new OrcaRuntimeService()
    runtime.setOrchestrationDb(db)
    ctx = { runtime }
  }

  afterEach(() => {
    db?.close()
    vi.clearAllMocks()
  })

  it('BUG: a second coordinator for a *different* worktree is rejected as "already running"', () => {
    setup()

    // Coordinator A starts, scoped to worktree wt-a.
    const runA = call('orchestration.run', { spec: 'spec-a', worktree: 'worktree:wt-a' }) as {
      runId: string
      status: string
    }
    expect(runA.status).toBe('running')

    // Coordinator B starts, scoped to a DISTINCT worktree wt-b.
    // CORRECT behavior: B has independent ownership and should start fine.
    // BUGGY behavior (pinned): the global active-run check ignores the worktree
    // selector, so B is rejected with A's run id.
    let error: Error | undefined
    try {
      call('orchestration.run', { spec: 'spec-b', worktree: 'worktree:wt-b' })
    } catch (err) {
      error = err as Error
    }
    expect(error).toBeInstanceOf(Error)
    expect(error?.message).toBe(`Coordinator already running: ${runA.runId}`)
    // ^ WRONG: a distinct-worktree coordinator collides with A's global run.
    //   Correct code would key the active-run lookup by worktree and let B start.
  })

  it("BUG: runStop takes no worktree scope and targets the other worktree's coordinator", () => {
    setup()

    // Only coordinator A is running (scoped to wt-a).
    const runA = call('orchestration.run', { spec: 'spec-a', worktree: 'worktree:wt-a' }) as {
      runId: string
    }

    // The runStop schema accepts NO worktree — there is no way to scope the stop.
    const stopMethod = findMethod('orchestration.runStop')
    const parsedEmpty = stopMethod.params!.parse({ worktree: 'worktree:wt-b' })
    // The extra `worktree` field is silently dropped by the empty schema.
    expect(parsedEmpty).toEqual({})
    // ^ WRONG: there is no worktree parameter, so a stop "from wt-b" cannot be scoped.

    // A stop issued from coordinator B's context resolves to the single global
    // active run — which is A — and stops it.
    const result = call('orchestration.runStop', { worktree: 'worktree:wt-b' }) as {
      runId: string
      stopped: boolean
    }
    expect(result).toEqual({ runId: runA.runId, stopped: true })
    // ^ WRONG: a stop meant for wt-b returns/stops A's run (wt-a).

    // And the coordinator that actually received .stop() is A (wt-a), not wt-b.
    expect(stopCalls).toEqual(['worktree:wt-a'])
    // ^ WRONG: correct behavior would stop only the wt-b coordinator (or no-op if
    //   none is running for wt-b), never A's.
  })
})

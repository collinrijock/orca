import { afterEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from './db'
import { reconcileLifecycleMessage } from './lifecycle-reconciliation'

// Repro for issue #7429: a `worker_done` that arrives without taskId/dispatchId
// in its payload is silently dropped (`action: 'ignored'`) BEFORE the
// terminal-ownership check, so the owning worker's in-flight task never
// auto-completes. See reconcileWorkerDoneMessage in lifecycle-reconciliation.ts
// lines 173-183: the null-id early-returns run before hasLifecycleAuthority.
describe('repro #7429: worker_done with null taskId/dispatchId', () => {
  let db: OrchestrationDb

  afterEach(() => db?.close())

  const LEAF_A = '11111111-1111-1111-8111-111111111111'

  it('BUG: drops a null-id worker_done from the pane that owns the sole in-flight dispatch', () => {
    db = new OrchestrationDb(':memory:')
    const task = db.createTask({ spec: 'work' })
    // A single in-flight dispatch, owned by term_worker / pane LEAF_A.
    db.createDispatchContext(task.id, 'term_worker', `tab_w:${LEAF_A}`)

    // The worker finished and emitted worker_done from the OWNING pane, but its
    // custom harness hand-crafted `--payload '{}'`, so both ids are absent.
    const logs: string[] = []
    const message = db.insertMessage({
      from: 'term_worker',
      to: 'term_coordinator',
      subject: 'Done',
      type: 'worker_done',
      payload: JSON.stringify({}),
      senderPaneKey: `tab_w:${LEAF_A}`
    })

    const result = reconcileLifecycleMessage(db, message, (line) => logs.push(line))

    // === BUG (current behavior pinned below) ===
    // The message came from the exact pane that owns the only live dispatch, so
    // the correct behavior would be `action: 'completed'` with the task marked
    // completed. Instead it is silently ignored and the task stays dispatched.
    expect(result).toEqual({ action: 'ignored' })
    expect(db.getTask(task.id)?.status).toBe('dispatched')
    // The only signal is a warning log line — no error surfaced to the sender.
    expect(logs.some((line) => line.includes('worker_done without taskId'))).toBe(true)

    // === CORRECT behavior (what SHOULD happen) — fails on the current tree ===
    // expect(result).toMatchObject({ action: 'completed' })
    // expect(db.getTask(task.id)?.status).toBe('completed')
  })

  it('BUG: a payloadless worker_done (null payload) is also dropped for the owning pane', () => {
    db = new OrchestrationDb(':memory:')
    const task = db.createTask({ spec: 'work' })
    db.createDispatchContext(task.id, 'term_worker', `tab_w:${LEAF_A}`)

    const message = db.insertMessage({
      from: 'term_worker',
      to: 'term_coordinator',
      subject: 'Done',
      type: 'worker_done',
      // No payload at all — parseObjectPayload yields {}, so ids are missing.
      senderPaneKey: `tab_w:${LEAF_A}`
    })

    // Pinned buggy behavior: dropped despite being the sole owning dispatch.
    expect(reconcileLifecycleMessage(db, message).action).toBe('ignored')
    expect(db.getTask(task.id)?.status).toBe('dispatched')
  })

  it('control: the SAME message WITH the ids completes the task (proves ids are the only difference)', () => {
    db = new OrchestrationDb(':memory:')
    const task = db.createTask({ spec: 'work' })
    const dispatch = db.createDispatchContext(task.id, 'term_worker', `tab_w:${LEAF_A}`)

    const message = db.insertMessage({
      from: 'term_worker',
      to: 'term_coordinator',
      subject: 'Done',
      type: 'worker_done',
      payload: JSON.stringify({ taskId: task.id, dispatchId: dispatch.id }),
      senderPaneKey: `tab_w:${LEAF_A}`
    })

    expect(reconcileLifecycleMessage(db, message).action).toBe('completed')
    expect(db.getTask(task.id)?.status).toBe('completed')
  })
})

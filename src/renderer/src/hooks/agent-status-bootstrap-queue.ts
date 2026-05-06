// Why: hook events forwarded by setListener() during the main-process hook
// server start() arrive synchronously during window creation, before App.tsx
// finishes its async hydration of repos + worktrees + tabs (which is what
// populates tabsByWorktree). Without a queue, resolvePaneKey() returns
// exists=false and the event is dropped — every hydrated entry from the on-
// disk last-status cache would be invisible. Buffer "tab not yet known"
// events while workspaceSessionReady is false and drain them on the
// false→true transition.

import type { ParsedAgentStatusPayload } from '../../../shared/agent-status-types'

export type QueuedAgentStatusEvent = {
  paneKey: string
  payload: ParsedAgentStatusPayload
  title: string | undefined
}

// Why: cap to keep memory bounded if something pathological holds
// workspaceSessionReady at false (e.g. a hydration failure in App.tsx). 200 is
// well above the realistic worst case of "agents per Orca user" and keeps the
// arrival order of the earliest entries — the ones with the strongest claim on
// dashboard state — intact under overflow (drop new entries, not head).
export const BOOTSTRAP_QUEUE_MAX = 200

let queue: QueuedAgentStatusEvent[] = []
let drained = false

export function enqueueAgentStatusBootstrap(entry: QueuedAgentStatusEvent): boolean {
  if (drained) {
    return false
  }
  if (queue.length >= BOOTSTRAP_QUEUE_MAX) {
    return false
  }
  queue.push(entry)
  return true
}

export function isBootstrapQueueDrained(): boolean {
  return drained
}

/** Drain the queue exactly once. Subsequent calls no-op. The visitor receives
 *  each queued event and decides whether to apply it (returning a truthy
 *  value isn't required — the visitor handles its own application). */
export function drainAgentStatusBootstrapQueue(
  visitor: (event: QueuedAgentStatusEvent) => void
): void {
  if (drained) {
    return
  }
  drained = true
  // Why: snapshot then clear before iterating so a re-entrant push during
  // visitor() (race with a new live hook event landing on the same paneKey)
  // is silently rejected rather than processed twice.
  const snapshot = queue
  queue = []
  for (const entry of snapshot) {
    visitor(entry)
  }
}

/** Reset between renders/tests. Called from useIpcEvents's mount effect so
 *  HMR / Strict Mode double-mount cannot accumulate stale entries; also
 *  exported for direct test access. */
export function resetAgentStatusBootstrapQueue(): void {
  queue = []
  drained = false
}

export function __getAgentStatusBootstrapQueueLengthForTests(): number {
  return queue.length
}

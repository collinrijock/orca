import { clampUtf8Tail } from './pty-eager-buffer-clamp'
import type { PtyDataMeta } from './pty-dispatcher'

type BufferedPreHandlerPtyData = {
  data: string
  bytes: number
  meta?: PtyDataMeta
}

type BufferedPreHandlerPtyState = {
  chunks: BufferedPreHandlerPtyData[]
  head: number
  bytes: number
  drainToken?: symbol
}

const preHandlerPtyData = new Map<string, BufferedPreHandlerPtyState>()
const preHandlerPtyExit = new Map<string, number>()

// Why: Windows startup commands can emit output before pty:spawn resolves and
// the pane registers its handler. Hold that tiny race window instead of ACKing
// and dropping the first setup-script bytes.
const PRE_HANDLER_PTY_DATA_MAX_BYTES = 512 * 1024
const PRE_HANDLER_PTY_DATA_MAX_PTYS = 64
const PRE_HANDLER_PTY_EXIT_MAX_PTYS = 64
// Why: evicted exits retain only a bounded id tombstone, not output. A larger
// window avoids turning one overflow into liveness IPC for unrelated panes.
const PRE_HANDLER_PTY_EVICTED_EXIT_MAX_PTYS = 1_024
const preHandlerPtyEvictedExitIds = new Set<string>()
const preHandlerPtyEvictedExitProbes = new Map<string, symbol>()
type PreHandlerPtyExitProbeRequest = {
  hasPty: (id: string) => Promise<boolean | null>
  handler: (code: number) => void
  isCurrent: () => boolean
}
const pendingPreHandlerPtyEvictedExitProbes = new Map<string, PreHandlerPtyExitProbeRequest>()
// Why: legit pre-attach windows drain within milliseconds and hold little
// data. Sustained accumulation means a pane lost its data handler (the
// frozen-pane detach/attach race) — leave a breadcrumb for trace capture.
const PRE_HANDLER_PTY_DATA_WARN_BYTES = 64 * 1024
const warnedLostHandlerPtyIds = new Set<string>()

export function bufferPreHandlerPtyData(ptyId: string, data: string, meta?: PtyDataMeta): void {
  const chunk = clampUtf8Tail(data, PRE_HANDLER_PTY_DATA_MAX_BYTES)
  if (!chunk.data) {
    return
  }
  if (!preHandlerPtyData.has(ptyId) && preHandlerPtyData.size >= PRE_HANDLER_PTY_DATA_MAX_PTYS) {
    const oldestPtyId = preHandlerPtyData.keys().next().value
    if (typeof oldestPtyId === 'string') {
      preHandlerPtyData.delete(oldestPtyId)
      warnedLostHandlerPtyIds.delete(oldestPtyId)
    }
  }
  const bufferedMeta =
    meta && chunk.data.length !== data.length && typeof meta.rawLength === 'number'
      ? { ...meta, rawLength: chunk.bytes }
      : meta
  let state = preHandlerPtyData.get(ptyId)
  if (!state) {
    state = { chunks: [], head: 0, bytes: 0 }
    preHandlerPtyData.set(ptyId, state)
  }
  state.chunks.push({
    data: chunk.data,
    bytes: chunk.bytes,
    ...(bufferedMeta ? { meta: bufferedMeta } : {})
  })
  state.bytes += chunk.bytes
  // Why: a missing handler can accumulate many small chunks; a stored total
  // and head index keep that failure path linear instead of rescanning/shifting.
  while (state.bytes > PRE_HANDLER_PTY_DATA_MAX_BYTES && state.head < state.chunks.length - 1) {
    state.bytes -= state.chunks[state.head].bytes
    state.chunks[state.head] = { data: '', bytes: 0 }
    state.head += 1
  }
  if (state.head > 0 && state.head * 2 >= state.chunks.length) {
    state.chunks.splice(0, state.head)
    state.head = 0
  }
  if (state.bytes > PRE_HANDLER_PTY_DATA_WARN_BYTES && !warnedLostHandlerPtyIds.has(ptyId)) {
    warnedLostHandlerPtyIds.add(ptyId)
    console.warn(
      `[pty] ${ptyId}: ${state.bytes} bytes buffered with no registered data handler; ` +
        'the owning pane may have lost its handler to a detach/attach race'
    )
  }
}

export function drainPreHandlerPtyData(
  ptyId: string,
  handler: (data: string, meta?: PtyDataMeta) => void,
  isCurrent: () => boolean = () => true
): void {
  const state = preHandlerPtyData.get(ptyId)
  warnedLostHandlerPtyIds.delete(ptyId)
  if (!state) {
    return
  }
  const drainToken = Symbol(ptyId)
  state.drainToken = drainToken
  while (state.head < state.chunks.length) {
    if (state.drainToken !== drainToken || !isCurrent()) {
      return
    }
    const index = state.head
    const chunk = state.chunks[index]
    state.chunks[index] = { data: '', bytes: 0 }
    state.head += 1
    state.bytes -= chunk.bytes
    handler(chunk.data, chunk.meta)
  }
  if (state.drainToken === drainToken && preHandlerPtyData.get(ptyId) === state) {
    preHandlerPtyData.delete(ptyId)
  }
}

export function bufferPreHandlerPtyExit(ptyId: string, code: number): void {
  if (!preHandlerPtyExit.has(ptyId) && preHandlerPtyExit.size >= PRE_HANDLER_PTY_EXIT_MAX_PTYS) {
    const oldestPtyId = preHandlerPtyExit.keys().next().value
    if (typeof oldestPtyId === 'string') {
      preHandlerPtyExit.delete(oldestPtyId)
      preHandlerPtyEvictedExitIds.add(oldestPtyId)
      if (preHandlerPtyEvictedExitIds.size > PRE_HANDLER_PTY_EVICTED_EXIT_MAX_PTYS) {
        const oldestEvictedId = preHandlerPtyEvictedExitIds.values().next().value
        if (typeof oldestEvictedId === 'string') {
          preHandlerPtyEvictedExitIds.delete(oldestEvictedId)
          preHandlerPtyEvictedExitProbes.delete(oldestEvictedId)
          pendingPreHandlerPtyEvictedExitProbes.delete(oldestEvictedId)
        }
      }
    }
  }
  preHandlerPtyExit.set(ptyId, code)
}

export function drainPreHandlerPtyExit(ptyId: string, handler: (code: number) => void): boolean {
  const code = preHandlerPtyExit.get(ptyId)
  if (code === undefined) {
    return false
  }
  preHandlerPtyExit.delete(ptyId)
  // Why: a concrete buffered exit supersedes any older overflow tombstone;
  // leaving its probe alive can synthesize a duplicate -1 exit afterward.
  preHandlerPtyEvictedExitIds.delete(ptyId)
  preHandlerPtyEvictedExitProbes.delete(ptyId)
  pendingPreHandlerPtyEvictedExitProbes.delete(ptyId)
  handler(code)
  return true
}

export function reconcilePreHandlerPtyExitAfterOverflow(
  ptyId: string,
  hasPty: ((id: string) => Promise<boolean | null>) | undefined,
  handler: (code: number) => void,
  isCurrent: () => boolean
): void {
  if (!preHandlerPtyEvictedExitIds.has(ptyId) || !hasPty) {
    return
  }
  const request = { hasPty, handler, isCurrent }
  if (preHandlerPtyEvictedExitProbes.has(ptyId)) {
    // Why: a same-ID replacement can install while the prior generation's
    // liveness readback is in flight. Keep the latest owner so it retries as
    // soon as the stale probe settles instead of stranding the exit tombstone.
    pendingPreHandlerPtyEvictedExitProbes.set(ptyId, request)
    return
  }
  startPreHandlerPtyExitOverflowProbe(ptyId, request)
}

function startPreHandlerPtyExitOverflowProbe(
  ptyId: string,
  request: PreHandlerPtyExitProbeRequest
): void {
  const probeToken = Symbol(ptyId)
  preHandlerPtyEvictedExitProbes.set(ptyId, probeToken)
  // Why: the bounded exit buffer may evict a legitimate pre-registration exit.
  // Keep its tombstone through unknown liveness so reconnect can retry proof.
  void request
    .hasPty(ptyId)
    .then((alive) => {
      if (
        preHandlerPtyEvictedExitProbes.get(ptyId) !== probeToken ||
        !request.isCurrent() ||
        !preHandlerPtyEvictedExitIds.has(ptyId) ||
        alive === null
      ) {
        return
      }
      preHandlerPtyEvictedExitIds.delete(ptyId)
      if (alive === false) {
        request.handler(-1)
      }
    })
    .catch(() => {})
    .finally(() => {
      // Why: a stale probe must not clear a newer same-ID generation's owner.
      if (preHandlerPtyEvictedExitProbes.get(ptyId) === probeToken) {
        preHandlerPtyEvictedExitProbes.delete(ptyId)
        const pendingRequest = pendingPreHandlerPtyEvictedExitProbes.get(ptyId)
        pendingPreHandlerPtyEvictedExitProbes.delete(ptyId)
        if (pendingRequest && preHandlerPtyEvictedExitIds.has(ptyId)) {
          startPreHandlerPtyExitOverflowProbe(ptyId, pendingRequest)
        }
      }
    })
}

export function clearPreHandlerPtyData(ptyId: string): void {
  preHandlerPtyData.delete(ptyId)
  warnedLostHandlerPtyIds.delete(ptyId)
}

export function clearPreHandlerPtyState(ptyId: string): void {
  preHandlerPtyData.delete(ptyId)
  preHandlerPtyExit.delete(ptyId)
  preHandlerPtyEvictedExitIds.delete(ptyId)
  preHandlerPtyEvictedExitProbes.delete(ptyId)
  pendingPreHandlerPtyEvictedExitProbes.delete(ptyId)
  warnedLostHandlerPtyIds.delete(ptyId)
}

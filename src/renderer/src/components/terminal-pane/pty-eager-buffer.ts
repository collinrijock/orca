import { TERMINAL_SCROLLBACK_SESSION_BUFFER_BYTE_LIMIT } from '../../../../shared/terminal-scrollback-limits'
import { clampUtf8Tail, type EagerBufferChunk } from './pty-eager-buffer-clamp'
import { ptyDataHandlers, ptyExitHandlers, ptyReplayHandlers } from './pty-primary-handler-registry'
import {
  createPtyPrimaryHandlerOwner,
  publishPtyPrimaryDataHandlerOwner,
  publishPtyPrimaryExitHandlerOwner,
  revokePtyPrimaryDataHandlerOwner,
  revokePtyPrimaryExitHandlerOwner
} from './pty-primary-handler-admission'
import {
  clearPreHandlerPtyState,
  drainPreHandlerPtyData,
  drainPreHandlerPtyExit,
  reconcilePreHandlerPtyExitAfterOverflow
} from './pty-pre-handler-buffer'

export type EagerPtyHandle = { flush: () => string; dispose: () => void }
const eagerPtyHandles = new Map<string, EagerPtyHandle>()

export function getEagerPtyBufferHandle(ptyId: string): EagerPtyHandle | undefined {
  return eagerPtyHandles.get(ptyId)
}

export function hasEagerPtyBufferHandles(): boolean {
  return eagerPtyHandles.size > 0
}

const EAGER_BUFFER_MAX_BYTES = TERMINAL_SCROLLBACK_SESSION_BUFFER_BYTE_LIMIT

export function registerEagerPtyBufferState(
  ptyId: string,
  onExit: (ptyId: string, code: number) => void
): EagerPtyHandle {
  // Why: a head index avoids quadratic Array.shift() behavior under many chunks.
  const chunks: EagerBufferChunk[] = []
  let head = 0
  let bufferBytes = 0
  const dataOwner = createPtyPrimaryHandlerOwner()
  const exitOwner = createPtyPrimaryHandlerOwner()

  const dataHandler = (data: string): void => {
    const chunk = clampUtf8Tail(data, EAGER_BUFFER_MAX_BYTES)
    chunks.push(chunk)
    bufferBytes += chunk.bytes
    while (bufferBytes > EAGER_BUFFER_MAX_BYTES && head < chunks.length - 1) {
      bufferBytes -= chunks[head].bytes
      chunks[head] = { data: '', bytes: 0 }
      head += 1
    }
    if (head > 0 && head * 2 >= chunks.length) {
      chunks.splice(0, head)
      head = 0
    }
  }
  const exitHandler = (code: number): void => {
    if (ptyDataHandlers.get(ptyId) === dataHandler) {
      ptyDataHandlers.delete(ptyId)
      ptyReplayHandlers.delete(ptyId)
    }
    ptyExitHandlers.delete(ptyId)
    revokePtyPrimaryDataHandlerOwner(ptyId, dataOwner)
    revokePtyPrimaryExitHandlerOwner(ptyId, exitOwner)
    eagerPtyHandles.delete(ptyId)
    onExit(ptyId, code)
  }

  ptyDataHandlers.set(ptyId, dataHandler)
  ptyExitHandlers.set(ptyId, exitHandler)
  publishPtyPrimaryDataHandlerOwner(ptyId, dataOwner)
  publishPtyPrimaryExitHandlerOwner(ptyId, exitOwner)

  const handle: EagerPtyHandle = {
    flush() {
      const data = chunks
        .slice(head)
        .map((chunk) => chunk.data)
        .join('')
      chunks.length = 0
      head = 0
      bufferBytes = 0
      return data
    },
    dispose() {
      // Why: a mounted pane may already have replaced these temporary handlers.
      if (ptyDataHandlers.get(ptyId) === dataHandler) {
        ptyDataHandlers.delete(ptyId)
        ptyReplayHandlers.delete(ptyId)
      }
      if (ptyExitHandlers.get(ptyId) === exitHandler) {
        ptyExitHandlers.delete(ptyId)
      }
      revokePtyPrimaryDataHandlerOwner(ptyId, dataOwner)
      revokePtyPrimaryExitHandlerOwner(ptyId, exitOwner)
      eagerPtyHandles.delete(ptyId)
    }
  }

  eagerPtyHandles.set(ptyId, handle)
  drainPreHandlerPtyData(ptyId, dataHandler)
  // Why: let callers receive the handle before a buffered exit invokes onExit.
  queueMicrotask(() => {
    if (ptyExitHandlers.get(ptyId) === exitHandler) {
      if (!drainPreHandlerPtyExit(ptyId, exitHandler)) {
        reconcilePreHandlerPtyExitAfterOverflow(
          ptyId,
          window.api.pty.hasPty,
          exitHandler,
          () => ptyExitHandlers.get(ptyId) === exitHandler
        )
      }
    } else {
      clearPreHandlerPtyState(ptyId)
    }
  })
  return handle
}

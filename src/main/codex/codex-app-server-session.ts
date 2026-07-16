import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { waitForProcessExitUntil } from './codex-process-exit-deadline'

export type CodexAppServerInvocation = {
  command: string
  args: string[]
  /** Overlay applied on top of the inherited environment (for example, CODEX_HOME). */
  env?: Record<string, string>
  /** Variables that would make this child select a different runtime than its caller. */
  envToDelete?: readonly string[]
  /** Whole-session deadline; the Codex child is killed when it lapses. */
  timeoutMs: number
}

export class CodexAppServerUnsupportedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CodexAppServerUnsupportedError'
  }
}

export class CodexAppServerTimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CodexAppServerTimeoutError'
  }
}

export function isCodexAppServerUnsupportedError(error: unknown): boolean {
  return error instanceof Error && error.name === 'CodexAppServerUnsupportedError'
}

type JsonRpcResponse = {
  id?: number
  result?: unknown
  error?: { code?: number; message?: string }
}

export type CodexAppServerRequestRpc = (
  method: string,
  params?: Record<string, unknown>
) => Promise<unknown>

const JSON_RPC_METHOD_NOT_FOUND = -32601
const STDERR_TAIL_MAX_BYTES = 8192
const STDOUT_LINE_MAX_BYTES = 1024 * 1024

function stderrIndicatesMissingAppServer(stderrTail: string): boolean {
  return /unrecognized subcommand|unexpected argument|invalid subcommand/i.test(stderrTail)
}

export async function runCodexAppServerSession<T>(
  invocation: CodexAppServerInvocation,
  run: (requestRpc: CodexAppServerRequestRpc) => Promise<T>,
  spawnImpl: typeof spawn = spawn
): Promise<T> {
  const childEnv = { ...process.env, ...invocation.env }
  // Why: default-home RPCs must observe the same missing CODEX_HOME as the
  // pane whose hook keys they inspect; omission alone would inherit Orca's value.
  for (const key of invocation.envToDelete ?? []) {
    delete childEnv[key]
  }
  const child = spawnImpl(invocation.command, invocation.args, {
    env: childEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  }) as ChildProcessWithoutNullStreams

  let stderrTail = ''
  let stdoutBuffer = ''
  let exited = false
  let nextRequestId = 1
  let timedOut = false
  let spawnError: Error | null = null
  const pending = new Map<
    number,
    { resolve: (response: JsonRpcResponse) => void; reject: (error: Error) => void }
  >()

  function buildEarlyExitError(): Error {
    if (stderrIndicatesMissingAppServer(stderrTail)) {
      return new CodexAppServerUnsupportedError(
        `codex CLI does not support the app-server subcommand: ${stderrTail.trim().slice(0, 400)}`
      )
    }
    return new Error(
      `codex app-server exited before completing the session${stderrTail ? `: ${stderrTail.trim().slice(0, 400)}` : ''}`
    )
  }

  function failPending(error: Error): void {
    for (const waiter of pending.values()) {
      waiter.reject(error)
    }
    pending.clear()
  }

  const exitPromise = new Promise<void>((resolve) => {
    child.on('exit', () => {
      exited = true
      resolve()
    })
  })
  // Why: a spawn failure emits `error` instead of `exit`; reject active RPCs
  // immediately so a missing executable cannot wait for the deadline.
  child.on('error', (error) => {
    spawnError = error
    exited = true
    failPending(error)
  })
  // Why: close guarantees the stderr tail is complete before classifying an
  // old CLI as unsupported rather than as a transient early exit.
  child.on('close', () => failPending(buildEarlyExitError()))
  // Why: JSONL may contain non-ASCII paths; stream decoding must retain a
  // multibyte character split across pipe chunks.
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL_MAX_BYTES)
  })
  // Why: the child can exit between the liveness check and stdin.write; an
  // EPIPE must reject the RPC instead of becoming an unhandled stream error.
  child.stdin.on('error', (error) => failPending(error))
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    stdoutBuffer += chunk
    if (Buffer.byteLength(stdoutBuffer) > STDOUT_LINE_MAX_BYTES) {
      child.kill('SIGKILL')
      failPending(new Error('codex app-server emitted an oversized JSONL response'))
      return
    }
    let newlineIndex
    while ((newlineIndex = stdoutBuffer.indexOf('\n')) !== -1) {
      const line = stdoutBuffer.slice(0, newlineIndex).trim()
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1)
      if (!line) {
        continue
      }
      let message: JsonRpcResponse
      try {
        message = JSON.parse(line) as JsonRpcResponse
      } catch {
        continue
      }
      if (typeof message.id === 'number' && pending.has(message.id)) {
        const waiter = pending.get(message.id)!
        pending.delete(message.id)
        waiter.resolve(message)
      }
    }
  })

  const deadline = setTimeout(() => {
    timedOut = true
    child.kill('SIGKILL')
    failPending(
      new CodexAppServerTimeoutError(
        `codex app-server session exceeded ${invocation.timeoutMs}ms (${invocation.command})`
      )
    )
  }, invocation.timeoutMs)

  const requestRpc: CodexAppServerRequestRpc = async (method, params) => {
    if (spawnError) {
      throw spawnError
    }
    if (timedOut) {
      throw new CodexAppServerTimeoutError('codex app-server session already timed out')
    }
    if (exited) {
      throw buildEarlyExitError()
    }
    const id = nextRequestId++
    const response = await new Promise<JsonRpcResponse>((resolve, reject) => {
      pending.set(id, { resolve, reject })
      try {
        child.stdin.write(`${JSON.stringify({ method, id, ...(params ? { params } : {}) })}\n`)
      } catch (error) {
        pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
    if (response.error) {
      if (
        response.error.code === JSON_RPC_METHOD_NOT_FOUND ||
        /method not found/i.test(response.error.message ?? '')
      ) {
        throw new CodexAppServerUnsupportedError(
          `codex app-server does not support ${method}: ${response.error.message ?? 'method not found'}`
        )
      }
      throw new Error(
        `codex app-server ${method} failed: ${response.error.message ?? 'unknown error'}`
      )
    }
    return response.result
  }

  try {
    await requestRpc('initialize', {
      clientInfo: { name: 'orca_desktop', title: 'Orca', version: '0.0.0' }
    })
    child.stdin.write(`${JSON.stringify({ method: 'initialized' })}\n`)
    return await run(requestRpc)
  } catch (error) {
    if (
      error instanceof Error &&
      !(error instanceof CodexAppServerUnsupportedError) &&
      !(error instanceof CodexAppServerTimeoutError) &&
      stderrIndicatesMissingAppServer(stderrTail)
    ) {
      throw new CodexAppServerUnsupportedError(
        `codex CLI does not support the app-server subcommand: ${stderrTail.trim().slice(0, 400)}`
      )
    }
    throw error
  } finally {
    try {
      child.stdin.end()
    } catch {
      // stdin may already be destroyed after a kill; reaping below still runs.
    }
    if (!exited) {
      await waitForProcessExitUntil(exitPromise, 1500)
      if (!exited) {
        child.kill('SIGKILL')
        await waitForProcessExitUntil(exitPromise, 1000)
      }
    }
    clearTimeout(deadline)
  }
}

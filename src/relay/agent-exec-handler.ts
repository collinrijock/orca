import { exec, spawn, type ChildProcess } from 'child_process'
import type { RelayDispatcher, RequestContext } from './dispatcher'
import { getSpawnPlan, isSpawnEnoent, type SpawnCommand } from './agent-exec-spawn-plan'

const DEFAULT_TIMEOUT_MS = 60_000
const MAX_TIMEOUT_MS = 5 * 60 * 1000
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024

// Why: mirrors src/main/text-generation/commit-message-text-generation.ts. On
// Windows, npm-installed CLIs like `claude`/`codex` are usually `.cmd` shims.
// We route those through cmd.exe so Node can launch them, and taskkill is
// needed to terminate the whole wrapper + node.exe process tree. Kept
// duplicated rather than imported because the relay ships to remote hosts.
function killProcessTree(child: ChildProcess): void {
  const pid = child.pid
  if (!pid) {
    return
  }
  if (process.platform === 'win32') {
    exec(`taskkill /pid ${pid} /T /F`, () => {
      // Best-effort; the spawn's `close` listener fires once the tree exits.
    })
    return
  }
  try {
    child.kill('SIGKILL')
  } catch {
    // Child may already have exited between the kill request and now.
  }
}

type ExecParams = {
  binary: unknown
  args: unknown
  cwd: unknown
  stdin: unknown
  timeoutMs: unknown
  env: unknown
  operation: unknown
  shell: unknown
}

type CancelParams = {
  cwd: unknown
  operation: unknown
}

function laneKeyFor(cwd: string, operation: unknown): string {
  const op = typeof operation === 'string' && operation ? operation : 'default'
  return JSON.stringify([op, cwd])
}

type InFlightExec = { child: ChildProcess; cancel: () => void }

type ExecResult = {
  stdout: string
  stderr: string
  exitCode: number | null
  timedOut: boolean
  /** Set when the user canceled the exec via `agent.cancelExec`. */
  canceled?: boolean
  /** Set when the binary could not be spawned (e.g. ENOENT). */
  spawnError?: string
}

/**
 * Non-interactive subprocess exec on the remote host. Used by the AI commit
 * message generator to spawn agent CLIs (claude, codex, …) with the staged
 * diff piped via stdin and the output captured to stdout. Distinct from
 * `pty.spawn` because we want no terminal allocation, no escape sequences,
 * and a clean exit code instead of an interactive session.
 */
export class AgentExecHandler {
  // Why: commit-message and PR-field generation can run together for one cwd;
  // operation lanes let cancel target only the user-visible job that stopped.
  private inFlightByLane = new Map<string, InFlightExec>()

  private laneKey(cwd: string, operation: unknown): string {
    return laneKeyFor(cwd, operation)
  }

  constructor(dispatcher: RelayDispatcher) {
    dispatcher.onRequest('agent.execNonInteractive', (p, context) =>
      this.exec(p as ExecParams, context)
    )
    dispatcher.onRequest('agent.cancelExec', (p) => this.cancel(p as CancelParams))
  }

  private async cancel(params: CancelParams): Promise<{ canceled: boolean }> {
    const cwd = typeof params.cwd === 'string' ? params.cwd : ''
    const entry = this.inFlightByLane.get(this.laneKey(cwd, params.operation))
    if (!entry) {
      return { canceled: false }
    }
    entry.cancel()
    return { canceled: true }
  }

  private async exec(params: ExecParams, context?: RequestContext): Promise<ExecResult> {
    const binary = typeof params.binary === 'string' ? params.binary : ''
    if (!binary) {
      throw new Error('agent.execNonInteractive: binary is required')
    }
    const args = Array.isArray(params.args) ? params.args.map((a) => String(a)) : []
    const cwd = typeof params.cwd === 'string' && params.cwd.length > 0 ? params.cwd : undefined
    const stdinPayload = typeof params.stdin === 'string' ? params.stdin : null
    const requestedTimeout =
      typeof params.timeoutMs === 'number' ? params.timeoutMs : DEFAULT_TIMEOUT_MS
    const timeoutMs = Math.max(1_000, Math.min(MAX_TIMEOUT_MS, requestedTimeout))
    const extraEnv =
      params.env && typeof params.env === 'object' && !Array.isArray(params.env)
        ? (params.env as Record<string, string>)
        : null
    const spawnEnv = extraEnv ? { ...process.env, ...extraEnv } : process.env
    const useShell = params.shell === true

    return new Promise<ExecResult>((resolve) => {
      const spawnPlannedChild = (plan: SpawnCommand): ChildProcess =>
        spawn(plan.spawnCmd, plan.spawnArgs, {
          cwd,
          env: spawnEnv,
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true
        })

      let child: ChildProcess
      let shellFallback: SpawnCommand | undefined
      try {
        const spawnPlan = getSpawnPlan(binary, args, spawnEnv, useShell)
        shellFallback = spawnPlan.shellFallback
        child = spawnPlannedChild(spawnPlan)
      } catch (error) {
        resolve({
          stdout: '',
          stderr: '',
          exitCode: null,
          timedOut: false,
          spawnError: error instanceof Error ? error.message : String(error)
        })
        return
      }

      let stdout = ''
      let stderr = ''
      let stdoutBytes = 0
      let stderrBytes = 0
      let timedOut = false
      let canceled = false
      let settled = false
      let shellFallbackUsed = false
      const laneKey = typeof cwd === 'string' ? this.laneKey(cwd, params.operation) : ''
      let entry: InFlightExec | null = null
      let timer: ReturnType<typeof setTimeout> | null = null
      let detachChildListeners = (): void => {}
      let detachRequestAbortListener = (): void => {}
      const finish = (result: ExecResult): void => {
        if (settled) {
          return
        }
        settled = true
        if (timer) {
          clearTimeout(timer)
          timer = null
        }
        detachRequestAbortListener()
        detachChildListeners()
        if (laneKey && entry && this.inFlightByLane.get(laneKey) === entry) {
          this.inFlightByLane.delete(laneKey)
        }
        resolve(result)
      }
      const sendStdin = (): void => {
        if (stdinPayload !== null) {
          child.stdin?.end(stdinPayload)
        } else {
          child.stdin?.end()
        }
      }
      const cancelCurrent = (): void => {
        canceled = true
        killProcessTree(child)
      }
      if (laneKey) {
        // Why: the relay owns one visible non-interactive job per cwd+operation.
        // Replacing the lane without canceling the prior child would orphan
        // that process until timeout because future cancelExec calls reach only
        // the newest map entry.
        this.inFlightByLane.get(laneKey)?.cancel()
        entry = {
          child,
          cancel: cancelCurrent
        }
        this.inFlightByLane.set(laneKey, entry)
      }

      timer = setTimeout(() => {
        timedOut = true
        // Why: tree-kill because some CLIs trap SIGTERM and continue streaming;
        // also Windows wraps `.cmd` shims in cmd.exe, so the immediate child
        // is not the real node.exe process.
        killProcessTree(child)
        finish({ stdout, stderr, exitCode: null, timedOut, canceled })
      }, timeoutMs)

      const onStdoutData = (chunk: Buffer): void => {
        stdoutBytes += chunk.byteLength
        if (stdoutBytes > MAX_OUTPUT_BYTES) {
          killProcessTree(child)
          return
        }
        stdout += chunk.toString('utf-8')
      }
      const onStderrData = (chunk: Buffer): void => {
        stderrBytes += chunk.byteLength
        if (stderrBytes > MAX_OUTPUT_BYTES) {
          killProcessTree(child)
          return
        }
        stderr += chunk.toString('utf-8')
      }
      const onError = (error: Error): void => {
        if (!settled && !canceled && !shellFallbackUsed && shellFallback && isSpawnEnoent(error)) {
          shellFallbackUsed = true
          detachChildListeners()
          try {
            child = spawnPlannedChild(shellFallback)
            if (entry) {
              entry.child = child
            }
            attachChildListeners()
            sendStdin()
          } catch (fallbackError) {
            finish({
              stdout,
              stderr,
              exitCode: null,
              timedOut,
              spawnError:
                fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
            })
          }
          return
        }
        finish({
          stdout,
          stderr,
          exitCode: null,
          timedOut,
          spawnError: error.message
        })
      }
      const onClose = (code: number | null): void => {
        finish({ stdout, stderr, exitCode: code, timedOut, canceled })
      }
      function attachChildListeners(): void {
        child.stdout?.on('data', onStdoutData)
        child.stderr?.on('data', onStderrData)
        child.on('error', onError)
        child.on('close', onClose)
        detachChildListeners = () => {
          child.stdout?.off('data', onStdoutData)
          child.stderr?.off('data', onStderrData)
          child.off('error', onError)
          child.off('close', onClose)
        }
      }
      attachChildListeners()

      if (context?.signal) {
        if (context.signal.aborted) {
          cancelCurrent()
        } else {
          context.signal.addEventListener('abort', cancelCurrent, { once: true })
          detachRequestAbortListener = () => {
            context.signal?.removeEventListener('abort', cancelCurrent)
          }
        }
      }

      sendStdin()
    })
  }
}

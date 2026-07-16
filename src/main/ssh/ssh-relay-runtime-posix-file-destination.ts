import type { SshRelayRuntimeSourceDestination } from './ssh-relay-runtime-source-stream'

type ChannelWriteCallback = (error?: Error) => void

export type SshRelayRuntimePosixFileChannel = Readonly<{
  write: (chunk: Buffer, callback: ChannelWriteCallback) => void
  end: () => void
  settled: Promise<void>
  requestClose: () => void
  forceClose: () => void
}>

export type OpenSshRelayRuntimePosixFileDestinationOptions = Readonly<{
  remotePath: string
  mode: 0o644 | 0o755
  signal: AbortSignal
  openChannel: (command: string, signal: AbortSignal) => Promise<SshRelayRuntimePosixFileChannel>
}>

export const SSH_RELAY_RUNTIME_POSIX_FILE_DESTINATION_LIMITS = Object.freeze({
  gracefulCloseMs: 250,
  totalCloseMs: 2_000
})

type DestinationState = 'open' | 'closing' | 'complete' | 'aborting' | 'aborted'

type ChannelSettlement = Readonly<{ ok: true } | { ok: false; error: unknown }>

type AbortOutcome = Readonly<{ reason: unknown }>

function validateRemotePath(remotePath: string): void {
  const segments = remotePath.split('/')
  if (
    remotePath === '/' ||
    !remotePath.startsWith('/') ||
    remotePath.includes('\0') ||
    remotePath.includes('\n') ||
    remotePath.includes('\r') ||
    segments.slice(1).some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error('SSH relay runtime POSIX file destination path is invalid')
  }
}

function validateOptions(options: OpenSshRelayRuntimePosixFileDestinationOptions): void {
  if (
    !options ||
    typeof options.remotePath !== 'string' ||
    typeof options.openChannel !== 'function' ||
    !options.signal
  ) {
    throw new Error('SSH relay runtime POSIX file destination input is invalid')
  }
  validateRemotePath(options.remotePath)
  if (options.mode !== 0o644 && options.mode !== 0o755) {
    throw new Error('SSH relay runtime POSIX file destination mode is invalid')
  }
}

function validateChannel(channel: SshRelayRuntimePosixFileChannel): void {
  if (
    !channel ||
    typeof channel.write !== 'function' ||
    typeof channel.end !== 'function' ||
    typeof channel.settled?.then !== 'function' ||
    typeof channel.requestClose !== 'function' ||
    typeof channel.forceClose !== 'function'
  ) {
    throw new Error('SSH relay runtime POSIX file channel is invalid')
  }
}

function quotePosixShellArgument(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function buildCommand(remotePath: string, mode: 0o644 | 0o755): string {
  const quotedPath = quotePosixShellArgument(remotePath)
  const finalMode = mode.toString(8).padStart(4, '0')
  // Why: noclobber plus umask makes authenticated staging exclusive and non-readable until EOF.
  return `umask 077; set -C; cat > ${quotedPath} && chmod ${finalMode} ${quotedPath}`
}

function cleanupFailure(failures: readonly unknown[]): unknown | undefined {
  if (failures.length === 0) {
    return undefined
  }
  return failures.length === 1
    ? failures[0]
    : new AggregateError(failures, 'SSH relay runtime POSIX file channel cleanup failed')
}

function waitForSettlement(
  settlement: Promise<ChannelSettlement>,
  timeoutMs: number
): Promise<boolean> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), timeoutMs)
    void settlement.then(() => {
      clearTimeout(timeout)
      resolve(true)
    })
  })
}

async function settleCancelledChannel(
  channel: SshRelayRuntimePosixFileChannel,
  settlement: Promise<ChannelSettlement>
): Promise<void> {
  const failures: unknown[] = []
  try {
    channel.requestClose()
  } catch (error) {
    failures.push(error)
  }

  const graceful = await waitForSettlement(
    settlement,
    SSH_RELAY_RUNTIME_POSIX_FILE_DESTINATION_LIMITS.gracefulCloseMs
  )
  if (!graceful) {
    try {
      channel.forceClose()
    } catch (error) {
      failures.push(error)
    }
    const forced = await waitForSettlement(
      settlement,
      SSH_RELAY_RUNTIME_POSIX_FILE_DESTINATION_LIMITS.totalCloseMs -
        SSH_RELAY_RUNTIME_POSIX_FILE_DESTINATION_LIMITS.gracefulCloseMs
    )
    if (!forced) {
      failures.unshift(new Error('SSH relay runtime POSIX file channel settlement timed out'))
    }
  }

  const failure = cleanupFailure(failures)
  if (failure !== undefined) {
    throw failure
  }
}

function createDestination(
  options: OpenSshRelayRuntimePosixFileDestinationOptions,
  channel: SshRelayRuntimePosixFileChannel
): SshRelayRuntimeSourceDestination {
  const { signal } = options
  const channelSettlement: Promise<ChannelSettlement> = channel.settled.then(
    () => ({ ok: true }),
    (error: unknown) => ({ ok: false, error })
  )
  let state: DestinationState = 'open'
  let activeOperation: Promise<void> | undefined
  let abortPromise: Promise<void> | undefined
  let abortReason: unknown
  let resolveAbortOutcome: (outcome: AbortOutcome) => void = () => {}
  const abortOutcome = new Promise<AbortOutcome>((resolve) => {
    resolveAbortOutcome = resolve
  })

  const assertWritable = (): void => {
    if (state !== 'open') {
      throw new Error('SSH relay runtime POSIX file destination is closed')
    }
    if (activeOperation) {
      throw new Error('SSH relay runtime POSIX file destination has a concurrent operation')
    }
  }

  const runExclusive = (operation: () => Promise<void>): Promise<void> => {
    const pending = operation()
    activeOperation = pending
    void pending
      .finally(() => {
        if (activeOperation === pending) {
          activeOperation = undefined
        }
      })
      .catch(() => {})
    return pending
  }

  const waitForOperation = async (operation: Promise<void>): Promise<void> => {
    const result = await Promise.race([
      operation.then(
        () => ({ kind: 'complete' as const }),
        (error: unknown) => ({ kind: 'failed' as const, error })
      ),
      abortOutcome.then((outcome) => ({ kind: 'aborted' as const, outcome }))
    ])
    if (result.kind === 'aborted') {
      throw result.outcome.reason
    }
    if (state === 'aborting' || state === 'aborted') {
      const outcome = await abortOutcome
      throw outcome.reason
    }
    if (result.kind === 'failed') {
      throw result.error
    }
  }

  const performAbort = async (): Promise<void> => {
    const reason = abortReason
    let failure: unknown
    try {
      await settleCancelledChannel(channel, channelSettlement)
    } catch (error) {
      failure = error
    } finally {
      state = 'aborted'
      signal.removeEventListener('abort', onSignalAbort)
      // Why: retained transport buffers are released only after the channel has settled or timed out.
      resolveAbortOutcome({ reason })
    }
    if (failure !== undefined) {
      throw failure
    }
  }

  const abort = (reason: unknown): Promise<void> => {
    if (abortPromise) {
      return abortPromise
    }
    if (state === 'complete' || state === 'aborted') {
      abortPromise = Promise.resolve()
      return abortPromise
    }
    state = 'aborting'
    abortReason = reason
    abortPromise = performAbort()
    return abortPromise
  }

  function onSignalAbort(): void {
    void abort(signal.reason).catch(() => {})
  }

  const write = (chunk: Buffer): Promise<void> => {
    try {
      assertWritable()
    } catch (error) {
      return Promise.reject(error)
    }
    if (!Buffer.isBuffer(chunk) || chunk.length === 0) {
      return Promise.reject(new Error('SSH relay runtime POSIX file destination chunk is empty'))
    }
    return runExclusive(async () => {
      signal.throwIfAborted()
      // Why: the callback is the byte-retention boundary before a source worker reuses its buffer.
      const accepted = new Promise<void>((resolve, reject) => {
        channel.write(chunk, (error) => (error ? reject(error) : resolve()))
      })
      await waitForOperation(accepted)
      signal.throwIfAborted()
    })
  }

  const close = (): Promise<void> => {
    try {
      assertWritable()
    } catch (error) {
      return Promise.reject(error)
    }
    state = 'closing'
    return runExclusive(async () => {
      signal.throwIfAborted()
      channel.end()
      const settled = await Promise.race([
        channelSettlement,
        abortOutcome.then((outcome) => ({ ok: false as const, error: outcome.reason }))
      ])
      if (state === 'aborting' || state === 'aborted') {
        const outcome = await abortOutcome
        throw outcome.reason
      }
      if (!settled.ok) {
        throw settled.error
      }
      signal.throwIfAborted()
      state = 'complete'
      signal.removeEventListener('abort', onSignalAbort)
    })
  }

  signal.addEventListener('abort', onSignalAbort, { once: true })
  if (signal.aborted) {
    onSignalAbort()
  }
  return Object.freeze({ write, close, abort })
}

export async function openSshRelayRuntimePosixFileDestination(
  options: OpenSshRelayRuntimePosixFileDestinationOptions
): Promise<SshRelayRuntimeSourceDestination> {
  validateOptions(options)
  options.signal.throwIfAborted()
  const channel = await options.openChannel(
    buildCommand(options.remotePath, options.mode),
    options.signal
  )
  validateChannel(channel)
  const destination = createDestination(options, channel)
  try {
    options.signal.throwIfAborted()
    return destination
  } catch (error) {
    try {
      await destination.abort(error)
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'SSH relay runtime POSIX file open cancellation cleanup failed'
      )
    }
    throw error
  }
}

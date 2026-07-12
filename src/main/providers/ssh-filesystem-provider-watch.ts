import type { SshChannelMultiplexer } from '../ssh/ssh-channel-multiplexer'
import type { FsChangeEvent } from '../../shared/types'

export type WatchRegistration = {
  callbacks: Set<(events: FsChangeEvent[]) => void>
  setupPromise: Promise<void>
}

function createWatchAbortError(): Error {
  const error = new Error('Request "fs.watch" was cancelled') as Error & { name: string }
  error.name = 'AbortError'
  return error
}

async function awaitSetupWithOptionalAbort(
  setupPromise: Promise<void>,
  signal?: AbortSignal
): Promise<void> {
  if (!signal) {
    await setupPromise
    return
  }
  if (signal.aborted) {
    throw createWatchAbortError()
  }
  await new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      cleanup()
      reject(createWatchAbortError())
    }
    const onSettled = (error?: unknown): void => {
      cleanup()
      if (error === undefined) {
        resolve()
      } else {
        reject(error)
      }
    }
    const cleanup = (): void => {
      signal.removeEventListener('abort', onAbort)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    setupPromise.then(
      () => onSettled(),
      (error) => onSettled(error)
    )
  })
}

export async function registerSshFilesystemWatch(args: {
  mux: SshChannelMultiplexer
  disposed: () => boolean
  registrations: Map<string, WatchRegistration>
  rootPath: string
  callback: (events: FsChangeEvent[]) => void
  signal?: AbortSignal
}): Promise<() => void> {
  if (args.disposed()) {
    throw new Error('SSH filesystem provider disposed')
  }
  if (args.signal?.aborted) {
    throw createWatchAbortError()
  }

  let registration = args.registrations.get(args.rootPath)
  if (registration) {
    registration.callbacks.add(args.callback)
    try {
      // Why: joiners cannot cancel a shared remote setup owned by the first
      // waiter, but they must still leave promptly when their own signal aborts.
      await awaitSetupWithOptionalAbort(registration.setupPromise, args.signal)
      assertActiveWatch(args, registration)
      return createSshFilesystemWatchUnsubscribe(args, registration)
    } catch (error) {
      registration.callbacks.delete(args.callback)
      throw error
    }
  }

  const callbacks = new Set<(events: FsChangeEvent[]) => void>([args.callback])
  // Why: thread the caller's AbortSignal into mux.request so an aborted
  // SSH-backed watch cancels remote fs.watch instead of waiting it out.
  const setupPromise = (
    args.signal
      ? args.mux.request('fs.watch', { rootPath: args.rootPath }, { signal: args.signal })
      : args.mux.request('fs.watch', { rootPath: args.rootPath })
  ).then(
    () => undefined,
    (error) => {
      if (args.registrations.get(args.rootPath) === registration) {
        args.registrations.delete(args.rootPath)
      }
      throw error
    }
  )
  registration = { callbacks, setupPromise }
  args.registrations.set(args.rootPath, registration)
  await setupPromise
  if (args.disposed() || args.registrations.get(args.rootPath) !== registration) {
    notifySshFilesystemUnwatch(args.mux, args.rootPath)
    throw new Error('SSH filesystem provider disposed')
  }

  return createSshFilesystemWatchUnsubscribe(args, registration)
}

export function notifySshFilesystemUnwatch(mux: SshChannelMultiplexer, rootPath: string): void {
  try {
    mux.notify('fs.unwatch', { rootPath })
  } catch {}
}

function assertActiveWatch(
  args: {
    disposed: () => boolean
    registrations: Map<string, WatchRegistration>
    rootPath: string
  },
  registration: WatchRegistration
): void {
  if (args.disposed() || args.registrations.get(args.rootPath) !== registration) {
    throw new Error('SSH filesystem provider disposed')
  }
}

function createSshFilesystemWatchUnsubscribe(
  args: {
    mux: SshChannelMultiplexer
    registrations: Map<string, WatchRegistration>
    rootPath: string
    callback: (events: FsChangeEvent[]) => void
  },
  registration: WatchRegistration
): () => void {
  return () => {
    registration.callbacks.delete(args.callback)
    if (
      registration.callbacks.size === 0 &&
      args.registrations.get(args.rootPath) === registration
    ) {
      args.registrations.delete(args.rootPath)
      notifySshFilesystemUnwatch(args.mux, args.rootPath)
    }
  }
}

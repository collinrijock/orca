import process from 'node:process'
import { startDaemon, type DaemonHandle } from '../../../src/main/daemon/daemon-main'
import { createPtySubprocess } from '../../../src/main/daemon/pty-subprocess'

type FixtureArgs = {
  protocolVersion: number
  socketPath: string
  tokenPath: string
  idleShutdownMs?: number
  pidPath?: string
  launchNonce?: string
}

function parseFixtureArgs(argv: string[]): FixtureArgs {
  const values = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key || !value) {
      throw new Error('Daemon generation fixture arguments must be key/value pairs')
    }
    values.set(key, value)
  }

  const protocolVersion = Number(values.get('--protocol'))
  const socketPath = values.get('--socket')
  const tokenPath = values.get('--token')
  if (!Number.isInteger(protocolVersion) || protocolVersion < 1 || !socketPath || !tokenPath) {
    throw new Error('Usage: daemon-generation-entry --protocol <n> --socket <path> --token <path>')
  }
  const rawIdleShutdownMs = values.get('--idle-shutdown-ms')
  const idleShutdownMs = rawIdleShutdownMs === undefined ? undefined : Number(rawIdleShutdownMs)
  const pidPath = values.get('--pid-record')
  const launchNonce = values.get('--launch-nonce')
  if (
    (idleShutdownMs !== undefined && (!Number.isInteger(idleShutdownMs) || idleShutdownMs < 1)) ||
    Boolean(pidPath) !== Boolean(launchNonce) ||
    (idleShutdownMs !== undefined && (!pidPath || !launchNonce))
  ) {
    throw new Error(
      'Idle fixture controls require a positive duration and PID-record ownership pair'
    )
  }
  return {
    protocolVersion,
    socketPath,
    tokenPath,
    ...(idleShutdownMs !== undefined ? { idleShutdownMs } : {}),
    ...(pidPath && launchNonce ? { pidPath, launchNonce } : {})
  }
}

async function main(): Promise<void> {
  const { protocolVersion, socketPath, tokenPath, idleShutdownMs, pidPath, launchNonce } =
    parseFixtureArgs(process.argv.slice(2))
  let daemon: DaemonHandle | null = await startDaemon({
    protocolVersion,
    socketPath,
    tokenPath,
    ...(pidPath && launchNonce ? { pidPath, launchNonce } : {}),
    ...(idleShutdownMs !== undefined
      ? {
          idleShutdownTestConfig: {
            durationMs: idleShutdownMs,
            clock: {
              setTimeout: (callback: () => void, delayMs: number) => setTimeout(callback, delayMs),
              clearTimeout: (handle: unknown) =>
                clearTimeout(handle as ReturnType<typeof setTimeout>)
            }
          }
        }
      : {}),
    spawnSubprocess: (opts) => createPtySubprocess(opts),
    onIdleShutdown: () => process.exit(0)
  })
  let shuttingDown = false
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) {
      return
    }
    shuttingDown = true
    try {
      await daemon?.shutdown()
      daemon = null
    } finally {
      process.exit(0)
    }
  }

  process.on('SIGTERM', () => void shutdown())
  process.on('SIGINT', () => void shutdown())
  process.send?.({
    type: 'ready',
    protocolVersion,
    startedAtMs: Date.now() - process.uptime() * 1000
  })
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})

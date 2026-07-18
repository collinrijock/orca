import type { DaemonPtyAdapter } from './daemon-pty-adapter'
import type { SessionInfo } from './types'

export type DaemonGenerationInventory = {
  adapter: DaemonPtyAdapter
  protocolVersion: number
  sessions: SessionInfo[]
}

export type DaemonGenerationDiscovery = {
  generations: DaemonGenerationInventory[]
  failedProtocols: number[]
}

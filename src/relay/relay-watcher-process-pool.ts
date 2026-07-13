import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { RuntimeWatcherProcessPool } from '../main/ipc/runtime-watcher-process-pool'
import { WatcherProcessSupervisor } from '../main/ipc/parcel-watcher-process-supervisor'

export type RelayWatcherProcessPool = Pick<
  RuntimeWatcherProcessPool,
  'dispose' | 'forgetRoot' | 'subscribe'
>

export function getRelayWatcherProcessEntryPath(): string {
  return join(__dirname, 'relay-watcher.js')
}

export function createRelayWatcherProcessPool(
  entryPath = getRelayWatcherProcessEntryPath()
): RelayWatcherProcessPool {
  return new RuntimeWatcherProcessPool({
    createSupervisor: () =>
      new WatcherProcessSupervisor({
        entryPath,
        // Why: source-level Vitest mocks Parcel in-process, while built relay
        // tests have the adjacent child and must exercise the real process boundary.
        useInProcessVitestFallback: !existsSync(entryPath)
      })
  })
}

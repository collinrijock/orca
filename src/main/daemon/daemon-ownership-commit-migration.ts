import {
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  closeSync,
  fstatSync,
  readSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import type { Stats } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  parseValidDaemonOwnershipCommit,
  withDaemonOwnershipCommit
} from './daemon-ownership-commit'

const MAX_OWNERSHIP_COMMIT_MIGRATION_BYTES = 8 * 1024 * 1024

type MigrationSource = {
  contents: string
  metadata: Stats
}

export function backfillDaemonOwnershipCommit(statePath: string): void {
  if (!existsSync(statePath)) {
    return
  }
  let state: Record<string, unknown> | null = null
  let source: MigrationSource | null = null
  try {
    const captured = readBoundedMigrationSource(statePath)
    if (!captured) {
      return
    }
    source = captured
    state = JSON.parse(source.contents) as Record<string, unknown>
    if (parseValidDaemonOwnershipCommit(state)) {
      return
    }
    if (Object.prototype.hasOwnProperty.call(state, 'daemonOwnershipCommit')) {
      // Why: a present-but-invalid commit can mean a torn or tampered write;
      // recommitting it would turn corrupted ownership absence into authority.
      return
    }
  } catch {
    return
  }

  if (!state || !source) {
    return
  }

  const committed = withDaemonOwnershipCommit(state, Date.now())
  mkdirSync(dirname(statePath), { recursive: true })
  const temporaryPath = `${statePath}.${process.pid}.${randomUUID()}.ownership.tmp`
  try {
    // Why: migration preserves the existing file mode and changes no semantic state fields.
    writeFileSync(temporaryPath, JSON.stringify(committed, null, 2), {
      encoding: 'utf8',
      mode: source.metadata.mode
    })
    renameSync(temporaryPath, statePath)
  } finally {
    try {
      unlinkSync(temporaryPath)
    } catch {
      // Successful rename consumes the temporary file.
    }
  }
}

function readBoundedMigrationSource(statePath: string): MigrationSource | null {
  const metadata = lstatSync(statePath)
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size > MAX_OWNERSHIP_COMMIT_MIGRATION_BYTES
  ) {
    return null
  }
  const descriptor = openSync(statePath, 'r')
  try {
    const opened = fstatSync(descriptor)
    if (
      !opened.isFile() ||
      opened.dev !== metadata.dev ||
      opened.ino !== metadata.ino ||
      opened.size !== metadata.size
    ) {
      return null
    }
    const buffer = Buffer.allocUnsafe(opened.size + 1)
    let captured = 0
    while (captured < buffer.length) {
      const bytesRead = readSync(descriptor, buffer, captured, buffer.length - captured, captured)
      if (bytesRead === 0) {
        break
      }
      captured += bytesRead
    }
    const afterRead = fstatSync(descriptor)
    if (
      captured !== opened.size ||
      afterRead.size !== opened.size ||
      afterRead.mtimeMs !== opened.mtimeMs
    ) {
      return null
    }
    return { contents: buffer.subarray(0, captured).toString('utf8'), metadata }
  } finally {
    closeSync(descriptor)
  }
}

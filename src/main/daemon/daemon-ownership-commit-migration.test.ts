import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  parseValidDaemonOwnershipCommit,
  withDaemonOwnershipCommit
} from './daemon-ownership-commit'
import { backfillDaemonOwnershipCommit } from './daemon-ownership-commit-migration'

describe('daemon ownership commit migration', () => {
  const roots: string[] = []

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('commits one active state file without changing semantic fields or scanning siblings', () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon-ownership-commit-'))
    roots.push(root)
    const original = { schemaVersion: 1, workspaceSession: { tabsByWorktree: {} } }
    const activePath = join(root, 'profiles', 'active', 'orca-data.json')
    const inactivePath = join(root, 'profiles', 'inactive', 'orca-data.json')
    for (const path of [activePath, inactivePath]) {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, JSON.stringify(original), 'utf8')
    }

    backfillDaemonOwnershipCommit(activePath)

    const parsed = JSON.parse(readFileSync(activePath, 'utf8')) as Record<string, unknown>
    expect(parseValidDaemonOwnershipCommit(parsed)).not.toBeNull()
    const { daemonOwnershipCommit: _commit, ...semanticState } = parsed
    expect(semanticState).toEqual(original)
    expect(JSON.parse(readFileSync(inactivePath, 'utf8'))).toEqual(original)
  })

  it('leaves malformed and symlink-like non-files untouched', () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon-ownership-commit-'))
    roots.push(root)
    const path = join(root, 'orca-data.json')
    writeFileSync(path, '{malformed', 'utf8')

    backfillDaemonOwnershipCommit(path)

    expect(readFileSync(path, 'utf8')).toBe('{malformed')
  })

  it('does not recommit a state file whose existing checksum is invalid', () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon-ownership-commit-'))
    roots.push(root)
    const path = join(root, 'orca-data.json')
    const committed = withDaemonOwnershipCommit(
      {
        schemaVersion: 1,
        claudeLivePtySessionIds: ['still-owned'],
        migrationUnsupportedPtyEntries: [{ ptyId: 'legacy-keep' }]
      },
      1
    )
    const tampered = {
      ...committed,
      claudeLivePtySessionIds: [],
      migrationUnsupportedPtyEntries: []
    }
    writeFileSync(path, JSON.stringify(tampered), 'utf8')

    backfillDaemonOwnershipCommit(path)

    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    expect(parsed).toEqual(tampered)
    expect(parseValidDaemonOwnershipCommit(parsed)).toBeNull()
  })
})

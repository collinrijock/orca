import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  describeCodexHomeChange,
  snapshotCodexHome,
  startCodexPrimaryHomeTripwire
} from './codex-primary-home-tripwire.mjs'

const cleanupPaths = []

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((cleanupPath) => rm(cleanupPath, { recursive: true }))
  )
})

async function createPrimaryHome() {
  const primaryHome = await mkdtemp(path.join(os.tmpdir(), 'orca-codex-tripwire-'))
  cleanupPaths.push(primaryHome)
  await mkdir(path.join(primaryHome, '.codex'))
  return primaryHome
}

describe('Codex primary-home tripwire', () => {
  it('detects a write without reading file contents', async () => {
    const primaryHome = await createPrimaryHome()
    const tripwire = await startCodexPrimaryHomeTripwire({ primaryHome, intervalMs: 25 })

    await writeFile(path.join(primaryHome, '.codex', 'hooks.json'), '{"secret":"not-read"}\n')
    await expect.poll(() => tripwire.getStatus().events.length, { timeout: 2_000 }).toBe(1)

    const status = await tripwire.stop()
    expect(status.clean).toBe(false)
    expect(status.events[0].changedPaths).toContain('hooks.json')
    expect(JSON.stringify(status)).not.toContain('not-read')
  })

  it('does not follow symlinks outside the watched home', async () => {
    const primaryHome = await createPrimaryHome()
    const externalRoot = await mkdtemp(path.join(os.tmpdir(), 'orca-codex-tripwire-external-'))
    cleanupPaths.push(externalRoot)
    const externalFile = path.join(externalRoot, 'credential.txt')
    await writeFile(externalFile, 'before')
    await symlink(externalFile, path.join(primaryHome, '.codex', 'linked-credential'))
    const before = await snapshotCodexHome(path.join(primaryHome, '.codex'))

    await writeFile(externalFile, 'after-with-a-different-size')
    const after = await snapshotCodexHome(path.join(primaryHome, '.codex'))

    expect(describeCodexHomeChange(before, after)).toBeNull()
  })
})

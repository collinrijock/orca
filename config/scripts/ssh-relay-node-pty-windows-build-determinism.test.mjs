import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { applyWindowsNodePtyBuildDeterminism } from './ssh-relay-node-pty-windows-build-determinism.mjs'

const temporaryDirectories = []
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })))
})

async function copiedSource() {
  const directory = await mkdtemp(join(tmpdir(), 'orca-node-pty-windows-determinism-'))
  temporaryDirectories.push(directory)
  await cp(resolve('node_modules/node-pty/binding.gyp'), join(directory, 'binding.gyp'))
  return directory
}

describe('SSH relay Windows node-pty build determinism', () => {
  it('adds deterministic MSVC linking only to the copied Windows source', async () => {
    const directory = await copiedSource()
    await expect(
      applyWindowsNodePtyBuildDeterminism({ nodePtyDirectory: directory, tuple: 'win32-arm64' })
    ).resolves.toBe(true)
    const source = await readFile(join(directory, 'binding.gyp'), 'utf8')
    expect(source.match(/'\/Brepro'/g)).toHaveLength(1)
  })

  it('leaves POSIX source untouched and rejects an unexpected Windows source shape', async () => {
    const directory = await copiedSource()
    const original = await readFile(join(directory, 'binding.gyp'), 'utf8')
    await expect(
      applyWindowsNodePtyBuildDeterminism({ nodePtyDirectory: directory, tuple: 'darwin-arm64' })
    ).resolves.toBe(false)
    expect(await readFile(join(directory, 'binding.gyp'), 'utf8')).toBe(original)

    await writeFile(join(directory, 'binding.gyp'), '{}', 'utf8')
    await expect(
      applyWindowsNodePtyBuildDeterminism({ nodePtyDirectory: directory, tuple: 'win32-x64' })
    ).rejects.toThrow('do not match the reviewed source')
  })
})

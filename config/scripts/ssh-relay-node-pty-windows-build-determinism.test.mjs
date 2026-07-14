import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  applyWindowsNodePtyBuildDeterminism,
  assertWindowsNodePtyGeneratedBuildSettings
} from './ssh-relay-node-pty-windows-build-determinism.mjs'

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

async function generatedProject({
  compilerOptions = '/Brepro /experimental:deterministic %(AdditionalOptions)',
  linkerOptions = '/Brepro /experimental:deterministic %(AdditionalOptions)',
  platform = 'ARM64'
} = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'orca-node-pty-windows-msbuild-'))
  temporaryDirectories.push(directory)
  await mkdir(join(directory, 'build'))
  await writeFile(
    join(directory, 'build', 'conpty_console_list.vcxproj'),
    `<Project><ItemDefinitionGroup Condition="'$(Configuration)|$(Platform)'=='Release|${platform}'"><ClCompile><AdditionalOptions>${compilerOptions}</AdditionalOptions></ClCompile><Link><AdditionalOptions>${linkerOptions}</AdditionalOptions></Link></ItemDefinitionGroup></Project>`
  )
  return directory
}

describe('SSH relay Windows node-pty build determinism', () => {
  it('adds deterministic MSVC compilation and linking only to the copied Windows source', async () => {
    const directory = await copiedSource()
    const repositorySource = await readFile(resolve('node_modules/node-pty/binding.gyp'), 'utf8')
    await expect(
      applyWindowsNodePtyBuildDeterminism({ nodePtyDirectory: directory, tuple: 'win32-arm64' })
    ).resolves.toBe(true)
    const source = await readFile(join(directory, 'binding.gyp'), 'utf8')
    const compilerStart = source.indexOf("'VCCLCompilerTool'")
    const linkerStart = source.indexOf("'VCLinkerTool'")
    const compilerOptions = source.slice(compilerStart, linkerStart)
    const linkerOptions = source.slice(linkerStart)
    expect(compilerOptions).toContain("'/Brepro'")
    expect(compilerOptions).toContain("'/experimental:deterministic'")
    expect(linkerOptions).toContain("'/Brepro'")
    expect(linkerOptions).toContain("'/experimental:deterministic'")
    expect(await readFile(resolve('node_modules/node-pty/binding.gyp'), 'utf8')).toBe(
      repositorySource
    )
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

  it('proves the generated Release project propagates compile and link settings', async () => {
    const directory = await generatedProject()
    await expect(
      assertWindowsNodePtyGeneratedBuildSettings({
        nodePtyDirectory: directory,
        tuple: 'win32-arm64'
      })
    ).resolves.toEqual({
      configuration: 'Release|ARM64',
      compilerOptions: ['/Brepro', '/experimental:deterministic'],
      linkerOptions: ['/Brepro', '/experimental:deterministic'],
      project: 'conpty_console_list.vcxproj'
    })
  })

  it('rejects missing, duplicate, non-inherited, or wrong-architecture generated settings', async () => {
    for (const fixture of [
      { compilerOptions: '/Brepro %(AdditionalOptions)' },
      { linkerOptions: '/Brepro /Brepro /experimental:deterministic %(AdditionalOptions)' },
      { linkerOptions: '/Brepro /experimental:deterministic' },
      { platform: 'x64' }
    ]) {
      const directory = await generatedProject(fixture)
      await expect(
        assertWindowsNodePtyGeneratedBuildSettings({
          nodePtyDirectory: directory,
          tuple: 'win32-arm64'
        })
      ).rejects.toThrow(/generated MSBuild settings/i)
    }
    await expect(
      assertWindowsNodePtyGeneratedBuildSettings({
        nodePtyDirectory: '/not-used-on-posix',
        tuple: 'darwin-arm64'
      })
    ).resolves.toBeUndefined()
  })
})

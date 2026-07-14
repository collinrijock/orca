import { execFileSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  classifyFile,
  collectPackageFiles,
  gitTreeSha,
  normalizeText,
  packageDigest
} from './generate-skill-bundle-manifest.mjs'

const temporaryDirectories = []

async function createPackage() {
  const directory = await mkdtemp(path.join(tmpdir(), 'orca-skill-manifest-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  )
})

describe('skill bundle manifest generator', () => {
  it('folds platform line endings for text identity', () => {
    const lf = Buffer.from('first\nsecond\n')
    const crlf = Buffer.from('first\r\nsecond\r\n')

    expect(classifyFile(lf)).toBe('text')
    expect(normalizeText(crlf)).toEqual(lf)
  })

  it('classifies null-containing and invalid UTF-8 content as binary', () => {
    expect(classifyFile(Buffer.from([0, 1, 2]))).toBe('binary')
    expect(classifyFile(Buffer.from([0xc3, 0x28]))).toBe('binary')
  })

  it('uses normalized text identity but exact executable identity', async () => {
    const packageRoot = await createPackage()
    await writeFile(path.join(packageRoot, 'SKILL.md'), 'line one\r\nline two\r\n')
    await writeFile(path.join(packageRoot, 'run.sh'), '#!/bin/sh\necho ok\n')
    await chmod(path.join(packageRoot, 'run.sh'), 0o755)

    const files = await collectPackageFiles(packageRoot)
    const skillFile = files.find((file) => file.path === 'SKILL.md')
    const executable = files.find((file) => file.path === 'run.sh')

    expect(skillFile.identitySha256).toBe(skillFile.textNormalizedSha256)
    expect(skillFile.identitySha256).not.toBe(skillFile.exactSha256)
    expect(executable.identitySha256).toBe(executable.exactSha256)
    expect(packageDigest(files)).toMatch(/^[a-f0-9]{64}$/)
  })

  it.runIf(process.platform === 'linux')('rejects case-colliding paths', async () => {
    const packageRoot = await createPackage()
    await writeFile(path.join(packageRoot, 'SKILL.md'), 'skill')
    await writeFile(path.join(packageRoot, 'Readme.md'), 'one')
    await writeFile(path.join(packageRoot, 'README.md'), 'two')

    await expect(collectPackageFiles(packageRoot)).rejects.toThrow('Case-colliding skill paths')
  })

  it.runIf(process.platform !== 'win32')('rejects symlinks inside shipped packages', async () => {
    const packageRoot = await createPackage()
    await writeFile(path.join(packageRoot, 'SKILL.md'), 'skill')
    await symlink('SKILL.md', path.join(packageRoot, 'linked.md'))

    await expect(collectPackageFiles(packageRoot)).rejects.toThrow(
      'Symlink is not allowed in a shipped skill'
    )
  })

  it('computes the same Git tree identity as Git', async () => {
    const packageRoot = path.resolve('skills', 'orca-cli')
    const files = await collectPackageFiles(packageRoot)
    const expected = execFileSync('git', ['ls-tree', 'HEAD:skills', 'orca-cli'], {
      encoding: 'utf8'
    })
      .trim()
      .split(/\s+/)[2]

    expect(gitTreeSha(files)).toBe(expected)
  })

  it('matches Git when a directory and file share a name prefix', async () => {
    const packageRoot = await createPackage()
    await mkdir(path.join(packageRoot, 'sub'))
    await writeFile(path.join(packageRoot, 'sub', 'inner.txt'), 'nested\n')
    await writeFile(path.join(packageRoot, 'sub.md'), 'sibling\n')
    const files = await collectPackageFiles(packageRoot)
    execFileSync('git', ['init', '--quiet'], { cwd: packageRoot })
    execFileSync('git', ['add', '-A'], { cwd: packageRoot })
    const expected = execFileSync('git', ['write-tree'], {
      cwd: packageRoot,
      encoding: 'utf8'
    }).trim()

    expect(gitTreeSha(files)).toBe(expected)
  })
})

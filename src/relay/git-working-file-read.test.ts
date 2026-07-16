import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readWorkingDiffFile } from './git-working-file-read'

describe('readWorkingDiffFile', () => {
  let tmpDir: string | null = null

  afterEach(async () => {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true })
    }
    tmpDir = null
  })

  it('reads normal text working-tree files', async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'relay-working-file-'))
    const filePath = path.join(tmpDir, 'file.txt')
    await writeFile(filePath, 'hello')

    await expect(readWorkingDiffFile(filePath)).resolves.toEqual({
      content: 'hello',
      isBinary: false
    })
  })

  it('marks oversized working-tree files as binary before diffing', async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'relay-working-file-'))
    const filePath = path.join(tmpDir, 'large.log')
    await writeFile(filePath, Buffer.alloc(10 * 1024 * 1024 + 1, 'a'))

    await expect(readWorkingDiffFile(filePath)).resolves.toEqual({
      content: '',
      isBinary: true
    })
  })

  it('base64-encodes a previewable image by its extension', async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'relay-working-file-'))
    const filePath = path.join(tmpDir, 'icon.png')
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01])
    await writeFile(filePath, pngBytes)

    await expect(readWorkingDiffFile(filePath)).resolves.toEqual({
      content: pngBytes.toString('base64'),
      isBinary: true
    })
  })
})

import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/test/user-data') },
  ipcMain: { handle: vi.fn() }
}))

import { writeTerminalRenderDesyncEvidence } from './terminal-render-desync-evidence'

const tempDirectories: string[] = []

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((dir) => rm(dir, { recursive: true })))
})

describe('writeTerminalRenderDesyncEvidence', () => {
  it('writes private PNG and metadata files under app-owned user data', async () => {
    const userData = await mkdtemp(path.join(os.tmpdir(), 'orca-render-desync-'))
    tempDirectories.push(userData)
    const result = await writeTerminalRenderDesyncEvidence(userData, {
      captureId: 'capture-1',
      phase: 'corrupt',
      pngDataUrl: `data:image/png;base64,${Buffer.from('png-bytes').toString('base64')}`,
      metadata: { bufferText: 'private terminal text' }
    })

    expect(await readFile(result.pngPath, 'utf8')).toBe('png-bytes')
    expect(JSON.parse(await readFile(result.metadataPath!, 'utf8'))).toEqual({
      bufferText: 'private terminal text'
    })
    if (process.platform !== 'win32') {
      expect((await stat(result.directory)).mode & 0o777).toBe(0o700)
      expect((await stat(result.pngPath)).mode & 0o777).toBe(0o600)
    }
  })

  it('rejects path traversal and non-PNG payloads', async () => {
    const userData = await mkdtemp(path.join(os.tmpdir(), 'orca-render-desync-'))
    tempDirectories.push(userData)
    await expect(
      writeTerminalRenderDesyncEvidence(userData, {
        captureId: '../outside',
        phase: 'corrupt',
        pngDataUrl: 'data:image/png;base64,eA=='
      })
    ).rejects.toThrow('Invalid render-desync capture id')
    await expect(
      writeTerminalRenderDesyncEvidence(userData, {
        captureId: 'capture-2',
        phase: 'corrupt',
        pngDataUrl: 'data:text/plain;base64,eA=='
      })
    ).rejects.toThrow('Invalid render-desync PNG payload')
  })
})

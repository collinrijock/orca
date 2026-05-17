import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  mergeMacUpdateManifestFiles,
  mergeMacUpdateManifests
} from './merge-macos-update-manifests.mjs'

const arm64Manifest = `version: 1.4.4-rc.1
files:
  - url: Orca-1.4.4-rc.1-arm64-mac.zip
    sha512: arm64zip
    size: 1
  - url: orca-macos-arm64.dmg
    sha512: arm64dmg
    size: 2
path: Orca-1.4.4-rc.1-arm64-mac.zip
sha512: arm64zip
releaseDate: '2026-05-17T00:00:00.000Z'
`

const x64Manifest = `version: 1.4.4-rc.1
files:
  - url: Orca-1.4.4-rc.1-mac.zip
    sha512: x64zip
    size: 3
  - url: orca-macos-x64.dmg
    sha512: x64dmg
    size: 4
path: Orca-1.4.4-rc.1-mac.zip
sha512: x64zip
releaseDate: '2026-05-17T00:01:00.000Z'
`

describe('mergeMacUpdateManifests', () => {
  it('merges per-arch macOS updater file entries into one manifest', () => {
    const merged = mergeMacUpdateManifests(arm64Manifest, x64Manifest)

    expect(merged).toContain('Orca-1.4.4-rc.1-arm64-mac.zip')
    expect(merged).toContain('Orca-1.4.4-rc.1-mac.zip')
    expect(merged).toContain('orca-macos-arm64.dmg')
    expect(merged).toContain('orca-macos-x64.dmg')
    expect(merged).toContain('path: Orca-1.4.4-rc.1-arm64-mac.zip')
  })

  it('rejects different versions', () => {
    expect(() =>
      mergeMacUpdateManifests(arm64Manifest, x64Manifest.replace('1.4.4-rc.1', '1.4.4-rc.2'))
    ).toThrow(/different versions/)
  })
})

describe('mergeMacUpdateManifestFiles', () => {
  it('writes the merged manifest to the primary path by default', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-mac-manifest-'))
    const primaryPath = join(dir, 'latest-mac.yml')
    const secondaryPath = join(dir, 'latest-mac-x64.yml')
    try {
      writeFileSync(primaryPath, arm64Manifest)
      writeFileSync(secondaryPath, x64Manifest)

      mergeMacUpdateManifestFiles(primaryPath, secondaryPath)

      const merged = readFileSync(primaryPath, 'utf8')
      expect(merged).toContain('orca-macos-arm64.dmg')
      expect(merged).toContain('orca-macos-x64.dmg')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { main } from './check-reliability-gates.mjs'

const tempDirs = []

function makeTempRoot(manifest) {
  const root = mkdtempSync(path.join(tmpdir(), 'orca-reliability-gates-'))
  tempDirs.push(root)
  const configDir = path.join(root, 'config')
  mkdirSync(configDir, { recursive: true })
  writeFileSync(path.join(configDir, 'reliability-gates.jsonc'), manifest, 'utf8')
  return root
}

function validManifest(overrides = {}) {
  return JSON.stringify(
    {
      schemaVersion: 1,
      gates: [
        {
          id: 'terminal-session.snapshot-freshness',
          title: 'Stale liveness snapshots cannot close newer PTY bindings',
          maturity: 'soak',
          owner: 'terminal-runtime',
          layer: 'renderer-unit',
          surfaces: ['terminal lifecycle'],
          platforms: ['macos', 'linux', 'windows'],
          providers: ['local', 'daemon'],
          motivatingLinks: ['https://github.com/stablyai/orca/issues/6773'],
          invariant: 'A stale snapshot cannot close a newer binding.',
          oracle: 'The test rejects reconciliation when the binding is newer than the snapshot.',
          commands: ['pnpm exec vitest run some.test.ts'],
          testFiles: ['some.test.ts'],
          runtimeBudget: {
            p95Seconds: 10,
            scope: 'local unit test'
          },
          flakeHistory: {
            status: 'unknown',
            evidence: 'Needs soak history.'
          },
          redGreenEvidence: {
            status: 'partial',
            evidence: 'Fails when the guard is removed.'
          },
          performanceBudget: {
            required: true,
            evidence: 'Perf measurement is required before blocking promotion.'
          },
          promotionCriteria: ['Collect soak history.'],
          knownGaps: ['Needs an Electron survival test.'],
          demotionRule: 'Demote on unexplained flakes.',
          ...overrides
        }
      ]
    },
    null,
    2
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { force: true, recursive: true })
  }
})

describe('check-reliability-gates', () => {
  it('accepts the checked-in manifest', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await expect(main(process.cwd())).resolves.toBe(0)
  })

  it('rejects soak gates without executable commands', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const root = makeTempRoot(validManifest({ commands: [] }))

    await expect(main(root)).resolves.toBe(1)
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Reliability gate manifest check failed')
    )
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('soak gates must declare at least one command')
    )
  })
})

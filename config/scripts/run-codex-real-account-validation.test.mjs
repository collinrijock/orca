import { mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createValidationEnv,
  createValidationLayout,
  snapshotValidationState
} from './run-codex-real-account-validation.mjs'

const cleanupPaths = []

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((cleanupPath) => rm(cleanupPath, { recursive: true }))
  )
})

describe('Codex real-account validation harness', () => {
  it('forces home and Codex routing variables after stripping ambient values', async () => {
    const primaryHome = path.join(os.tmpdir(), 'orca-primary-home-sentinel')
    const layout = await createValidationLayout({ primaryHome })
    cleanupPaths.push(layout.tempRoot)
    const env = createValidationEnv(
      {
        HOME: primaryHome,
        USERPROFILE: primaryHome,
        CODEX_HOME: '/unsafe/codex',
        ORCA_CODEX_HOME: '/unsafe/orca-codex',
        ZDOTDIR: '/unsafe/zsh',
        SAFE_VALUE: 'preserved'
      },
      layout
    )

    expect(env.HOME).toBe(layout.homeDir)
    expect(env.USERPROFILE).toBe(layout.homeDir)
    expect(env.CODEX_HOME).toBeUndefined()
    expect(env.ORCA_CODEX_HOME).toBeUndefined()
    expect(env.ZDOTDIR).toBeUndefined()
    expect(env.ORCA_CODEX_SYSTEM_DEFAULT_REAL_HOME).toBe('1')
    expect(env.SAFE_VALUE).toBe('preserved')
  })

  it('records only a fingerprint for managed auth', async () => {
    const layout = await createValidationLayout({
      primaryHome: path.join(os.tmpdir(), 'orca-primary-home-sentinel')
    })
    cleanupPaths.push(layout.tempRoot)
    const managedHome = path.join(layout.userDataDir, 'codex-accounts', 'account-1', 'home')
    await mkdir(managedHome, { recursive: true })
    await writeFile(path.join(managedHome, 'auth.json'), '{"refresh_token":"never-report-me"}\n')

    const snapshot = await snapshotValidationState(layout)

    expect(snapshot.managedHomes[0].auth.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(snapshot)).not.toContain('never-report-me')
  })
})

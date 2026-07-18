import { execFileSync } from 'node:child_process'
import { rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const cleanupPaths: string[] = []
const validationModuleUrl = pathToFileURL(
  path.resolve('config/scripts/run-codex-real-account-validation.mjs')
).href

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((cleanupPath) => rm(cleanupPath, { recursive: true }))
  )
})

describe('Codex real-account validation harness', () => {
  it('forces home and Codex routing variables after stripping ambient values', async () => {
    const primaryHome = path.join(os.tmpdir(), 'orca-primary-home-sentinel')
    const { layout, env } = runValidationModule<{
      layout: { tempRoot: string; homeDir: string }
      env: Record<string, string | undefined>
    }>(
      `
        const { createValidationEnv, createValidationLayout } = await import(process.argv[1])
        const primaryHome = process.argv[2]
        const layout = await createValidationLayout({ primaryHome })
        const env = createValidationEnv({
          HOME: primaryHome,
          USERPROFILE: primaryHome,
          CODEX_HOME: '/unsafe/codex',
          ORCA_CODEX_HOME: '/unsafe/orca-codex',
          ZDOTDIR: '/unsafe/zsh',
          SAFE_VALUE: 'preserved'
        }, layout)
        console.log(JSON.stringify({ layout, env }))
      `,
      [primaryHome]
    )
    cleanupPaths.push(layout.tempRoot)

    expect(env.HOME).toBe(layout.homeDir)
    expect(env.USERPROFILE).toBe(layout.homeDir)
    expect(env.CODEX_HOME).toBeUndefined()
    expect(env.ORCA_CODEX_HOME).toBeUndefined()
    expect(env.ZDOTDIR).toBeUndefined()
    expect(env.ORCA_CODEX_SYSTEM_DEFAULT_REAL_HOME).toBe('1')
    expect(env.SAFE_VALUE).toBe('preserved')
  })

  it('records only fingerprints for system-default and managed auth', async () => {
    const { layout, snapshot } = runValidationModule<{
      layout: { tempRoot: string }
      snapshot: {
        throwawayCodex: { auth: { sha256?: string } }
        managedHomes: { auth: { sha256?: string } }[]
      }
    }>(
      `
        import path from 'node:path'
        import { mkdir, writeFile } from 'node:fs/promises'
        const { createValidationLayout, snapshotValidationState } = await import(process.argv[1])
        const layout = await createValidationLayout({ primaryHome: process.argv[2] })
        const systemHome = path.join(layout.homeDir, '.codex')
        const managedHome = path.join(layout.userDataDir, 'codex-accounts', 'account-1', 'home')
        await Promise.all([
          mkdir(systemHome, { recursive: true }),
          mkdir(managedHome, { recursive: true })
        ])
        await writeFile(path.join(systemHome, 'auth.json'), '{"refresh_token":"system-secret"}\\n')
        await writeFile(path.join(managedHome, 'auth.json'), '{"refresh_token":"never-report-me"}\\n')
        console.log(JSON.stringify({ layout, snapshot: await snapshotValidationState(layout) }))
      `,
      [path.join(os.tmpdir(), 'orca-primary-home-sentinel')]
    )
    cleanupPaths.push(layout.tempRoot)

    expect(snapshot.throwawayCodex.auth.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(snapshot.managedHomes[0].auth.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(snapshot)).not.toContain('system-secret')
    expect(JSON.stringify(snapshot)).not.toContain('never-report-me')
  })
})

function runValidationModule<T>(source: string, args: string[]): T {
  const stdout = execFileSync(
    process.execPath,
    ['--input-type=module', '--eval', source, validationModuleUrl, ...args],
    { encoding: 'utf8' }
  )
  return JSON.parse(stdout.trim()) as T
}

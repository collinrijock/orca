import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { detectAgentHookCliPresence } from './agent-hook-cli-presence'

describe('detectAgentHookCliPresence', () => {
  const originalPath = process.env.PATH
  const originalHome = process.env.HOME
  let tmpDir: string | null = null

  afterEach(() => {
    process.env.PATH = originalPath
    process.env.HOME = originalHome
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true })
      tmpDir = null
    }
  })

  it.runIf(process.platform !== 'win32')(
    'detects known agent binaries from relay PATH',
    async () => {
      tmpDir = mkdtempSync(join(tmpdir(), 'orca-relay-cli-presence-'))
      const codex = join(tmpDir, 'codex')
      writeFileSync(codex, '#!/bin/sh\n')
      chmodSync(codex, 0o755)
      process.env.PATH = tmpDir

      const response = await detectAgentHookCliPresence(
        { agents: ['codex', 'claude'] },
        { readShellPathEntries: async () => [tmpDir as string] }
      )

      expect(response.presence.codex?.state).toBe('found')
      expect(response.presence.claude?.state).toBe('missing')
    }
  )

  it.runIf(process.platform !== 'win32')(
    'detects override executable paths that contain spaces',
    async () => {
      tmpDir = mkdtempSync(join(tmpdir(), 'orca relay cli presence '))
      const codex = join(tmpDir, 'codex')
      writeFileSync(codex, '#!/bin/sh\n')
      chmodSync(codex, 0o755)
      process.env.PATH = ''

      const response = await detectAgentHookCliPresence({
        agents: ['codex'],
        overrideExecutableTokens: { codex }
      })

      expect(response.presence.codex?.state).toBe('found')
    }
  )

  it.runIf(process.platform !== 'win32')(
    'detects known agent binaries from the login-shell PATH',
    async () => {
      tmpDir = mkdtempSync(join(tmpdir(), 'orca-relay-shell-path-'))
      const codex = join(tmpDir, 'codex')
      writeFileSync(codex, '#!/bin/sh\n')
      chmodSync(codex, 0o755)
      process.env.PATH = ''

      const response = await detectAgentHookCliPresence(
        { agents: ['codex'] },
        { readShellPathEntries: async () => [tmpDir as string] }
      )

      expect(response.presence.codex?.state).toBe('found')
    }
  )

  it.runIf(process.platform !== 'win32')(
    'expands home-relative override executable paths before probing',
    async () => {
      tmpDir = mkdtempSync(join(tmpdir(), 'orca-relay-home-'))
      process.env.HOME = tmpDir
      const binDir = join(tmpDir, 'bin')
      const codex = join(binDir, 'codex')
      mkdirSync(binDir)
      writeFileSync(codex, '#!/bin/sh\n')
      chmodSync(codex, 0o755)
      process.env.PATH = ''

      const response = await detectAgentHookCliPresence({
        agents: ['codex'],
        overrideExecutableTokens: { codex: '~/bin/codex' }
      })

      expect(response.presence.codex?.state).toBe('found')
    }
  )

  it.runIf(process.platform !== 'win32')(
    'reports unknown for a relative override path instead of probing the relay CWD',
    async () => {
      // Why: a relative override resolves against the agent's launch CWD, not
      // the relay process CWD, so probing it here could falsely report presence
      // for an unrelated directory — mirror the local detector and skip it.
      process.env.PATH = ''

      const response = await detectAgentHookCliPresence({
        agents: ['codex'],
        overrideExecutableTokens: { codex: 'bin/codex' }
      })

      expect(response.presence.codex?.state).toBe('unknown')
    }
  )

  it('rejects unknown agent ids', async () => {
    await expect(detectAgentHookCliPresence({ agents: ['codex', 'not-real'] })).rejects.toThrow(
      'unknown_agent'
    )
  })

  it('rejects unsafe override executable tokens', async () => {
    await expect(
      detectAgentHookCliPresence({
        agents: ['codex'],
        overrideExecutableTokens: { codex: 'codex; rm -rf /' }
      })
    ).rejects.toThrow('invalid_override_token')
  })
})

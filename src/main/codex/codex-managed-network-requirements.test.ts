import { afterEach, describe, expect, it, vi } from 'vitest'

const { execFileSyncMock, existsSyncMock, readFileSyncMock } = vi.hoisted(() => ({
  execFileSyncMock: vi.fn(),
  existsSyncMock: vi.fn(),
  readFileSyncMock: vi.fn()
}))

vi.mock('node:child_process', () => ({
  execFileSync: execFileSyncMock
}))

vi.mock('node:fs', () => ({
  existsSync: existsSyncMock,
  readFileSync: readFileSyncMock
}))

import {
  buildCodexManagedNetworkRequirementsWarningCommand,
  hasManagedCodexNetworkPermissionRequirement
} from './codex-managed-network-requirements'

const REPRO_REQUIREMENTS = [
  'default_permissions = "github_only"',
  '',
  '[permissions.github_only]',
  'extends = ":read-only"',
  '',
  '[permissions.github_only.network]',
  'enabled = true',
  'allow_local_binding = false',
  ''
].join('\n')

describe('codex managed network requirements', () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform)
    }
    vi.clearAllMocks()
  })

  it('detects macOS MDM requirements with enabled permission-profile networking', () => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' })
    execFileSyncMock.mockReturnValue(`${Buffer.from(REPRO_REQUIREMENTS).toString('base64')}\n`)
    existsSyncMock.mockReturnValue(false)

    expect(hasManagedCodexNetworkPermissionRequirement()).toBe(true)
    expect(execFileSyncMock).toHaveBeenCalledWith(
      'defaults',
      ['read', 'com.openai.codex', 'requirements_toml_base64'],
      expect.objectContaining({ encoding: 'utf-8' })
    )
  })

  it('detects system requirements with enabled permission-profile networking', () => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'linux' })
    existsSyncMock.mockReturnValue(true)
    readFileSyncMock.mockReturnValue(REPRO_REQUIREMENTS)

    expect(hasManagedCodexNetworkPermissionRequirement()).toBe(true)
  })

  it('ignores requirements without permission-profile network enablement', () => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' })
    execFileSyncMock.mockReturnValue(
      `${Buffer.from('[permissions.github_only.network]\\nenabled = false\\n').toString('base64')}\n`
    )
    existsSyncMock.mockReturnValue(false)

    expect(hasManagedCodexNetworkPermissionRequirement()).toBe(false)
  })

  it('builds a shell-safe warning command', () => {
    const command = buildCodexManagedNetworkRequirementsWarningCommand()

    expect(command).toContain('printf')
    expect(command).toContain('managed Codex requirements')
    expect(command).toContain('turn/start failed in TUI')
  })
})

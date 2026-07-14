import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SshConnection } from './ssh-connection'
import { getRemoteHostPlatform } from './ssh-remote-platform'

const execCommandMock = vi.hoisted(() => vi.fn())

vi.mock('./ssh-relay-deploy-helpers', () => ({
  execCommand: execCommandMock
}))

const { resolveRemoteNodePath } = await import('./ssh-remote-node-resolution')

const conn = {} as SshConnection
const fixtureDirectories: string[] = []

function writeExecutable(filePath: string, output: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, `#!/bin/sh\nprintf '%s\\n' '${output}'\n`)
  chmodSync(filePath, 0o755)
}

function decodePowerShellCommand(command: string): string {
  const encoded = command.match(/-EncodedCommand\s+([A-Za-z0-9+/=]+)/)?.[1]
  if (!encoded) {
    throw new Error(`No encoded PowerShell command found in: ${command}`)
  }
  return Buffer.from(encoded, 'base64').toString('utf16le')
}

describe('remote Node/npm toolchain resolution', () => {
  beforeEach(() => {
    execCommandMock.mockReset()
  })

  afterEach(() => {
    for (const directory of fixtureDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('reproduces the guarded NVM layout and skips system Node without npm', async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'orca-node-toolchain-'))
    fixtureDirectories.push(home)
    const systemBin = path.join(home, 'usr/bin')
    const systemNode = path.join(systemBin, 'node')
    const nvmBin = path.join(home, '.nvm/versions/node/v22.22.0/bin')
    const nvmNode = path.join(nvmBin, 'node')

    writeExecutable(systemNode, 'v18.19.1')
    writeExecutable(nvmNode, 'v22.22.0')
    writeExecutable(path.join(nvmBin, 'npm'), '11.13.0')
    // Why: Ubuntu's non-interactive guard prevents sourcing NVM, so discovery
    // must inspect the install directory instead of relying on shell startup.
    writeFileSync(
      path.join(home, '.bashrc'),
      'case $- in\n  *i*) ;;\n  *) return;;\nesac\nexport NVM_DIR="$HOME/.nvm"\n'
    )

    execCommandMock.mockImplementation((_connection, command: string) =>
      execFileSync('/bin/sh', ['-c', command], {
        encoding: 'utf8',
        env: { HOME: home, PATH: `${systemBin}:/usr/bin:/bin`, SHELL: '/bin/bash' },
        stdio: ['ignore', 'pipe', 'pipe']
      })
    )

    await expect(resolveRemoteNodePath(conn)).resolves.toBe(nvmNode)
    expect(execCommandMock.mock.calls[1]![1]).toContain(`${systemBin}/npm`)
    expect(execCommandMock.mock.calls[2]![1]).toContain(`${nvmBin}/npm`)
  })

  it('rejects an old Node even when its colocated npm succeeds', async () => {
    execCommandMock
      .mockResolvedValueOnce('/old/bin/node\n/current/bin/node\n')
      .mockResolvedValueOnce('v16.20.2\n10.8.2\n')
      .mockResolvedValueOnce('v22.22.0\n11.13.0\n')

    await expect(resolveRemoteNodePath(conn)).resolves.toBe('/current/bin/node')
  })

  it('does not pair Node with npm from a different PATH directory', async () => {
    execCommandMock
      .mockResolvedValueOnce('/system/bin/node\n/nvm/bin/node\n')
      .mockRejectedValueOnce(new Error('/system/bin/npm: not found'))
      .mockResolvedValueOnce('v22.22.0\n11.13.0\n')

    await expect(resolveRemoteNodePath(conn)).resolves.toBe('/nvm/bin/node')
    expect(execCommandMock.mock.calls[1]![1]).toBe(
      "printf '%s\\n' '__ORCA_NODE_VERSION__' && '/system/bin/node' --version && printf '%s\\n' '__ORCA_NPM_VERSION__' && PATH='/system/bin':$PATH '/system/bin/npm' --version"
    )
    expect(execCommandMock.mock.calls[1]![2]).toEqual({ wrapCommand: true })
  })

  it('skips a colocated npm shim that fails when invoked', async () => {
    execCommandMock
      .mockResolvedValueOnce('/broken/bin/node\n/usable/bin/node\n')
      .mockRejectedValueOnce(new Error('npm shim target is missing'))
      .mockResolvedValueOnce('v20.11.0\n10.5.0\n')

    await expect(resolveRemoteNodePath(conn)).resolves.toBe('/usable/bin/node')
  })

  it('accepts a marked Node version after login-shell startup noise', async () => {
    execCommandMock
      .mockResolvedValueOnce('/usable/bin/node\n')
      .mockResolvedValueOnce(
        'Welcome to the remote host\n__ORCA_NODE_VERSION__\nv20.11.0\n__ORCA_NPM_VERSION__\n10.5.0\n'
      )

    await expect(resolveRemoteNodePath(conn)).resolves.toBe('/usable/bin/node')
  })

  it('ignores startup noise around login-shell and node-path markers', async () => {
    execCommandMock
      .mockResolvedValueOnce('\n')
      .mockResolvedValueOnce('outer banner\n__ORCA_LOGIN_SHELL__\n/usr/bin/fish\n')
      .mockResolvedValueOnce('fish greeting\n__ORCA_NODE_PATH__\n/usable/bin/node\n')
      .mockResolvedValueOnce('__ORCA_NODE_VERSION__\nv20.11.0\n__ORCA_NPM_VERSION__\n10.5.0\n')

    await expect(resolveRemoteNodePath(conn)).resolves.toBe('/usable/bin/node')
  })

  it('rejects a zero-exit npm shim without a version', async () => {
    execCommandMock
      .mockResolvedValueOnce('/broken/bin/node\n/usable/bin/node\n')
      .mockResolvedValueOnce(
        '__ORCA_NODE_VERSION__\nv20.11.0\n__ORCA_NPM_VERSION__\nshim did nothing\n'
      )
      .mockResolvedValueOnce('__ORCA_NODE_VERSION__\nv20.11.0\n__ORCA_NPM_VERSION__\n10.5.0\n')

    await expect(resolveRemoteNodePath(conn)).resolves.toBe('/usable/bin/node')
  })

  it('skips Windows Node without npm.cmd and keeps probing candidates', async () => {
    execCommandMock
      .mockResolvedValueOnce('C:\\incomplete\\node.exe\nC:\\Program Files\\nodejs\\node.exe\n')
      .mockRejectedValueOnce(new Error('npm.cmd not found'))
      .mockResolvedValueOnce('v20.11.0\n10.5.0\n')

    await expect(resolveRemoteNodePath(conn, getRemoteHostPlatform('win32-x64'))).resolves.toBe(
      'C:/Program Files/nodejs/node.exe'
    )

    const incompleteProbe = decodePowerShellCommand(execCommandMock.mock.calls[1]![1] as string)
    const selectedProbe = decodePowerShellCommand(execCommandMock.mock.calls[2]![1] as string)
    expect(incompleteProbe).toContain("Test-Path -LiteralPath 'C:/incomplete/npm.cmd'")
    expect(selectedProbe).toContain("Write-Output '__ORCA_NODE_VERSION__'")
    expect(selectedProbe).toContain("Write-Output '__ORCA_NPM_VERSION__'")
    expect(selectedProbe).toContain("& 'C:/Program Files/nodejs/npm.cmd' --version")
  })
})

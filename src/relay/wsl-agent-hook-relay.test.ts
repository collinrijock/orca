// Guest-side WSL hook relay pieces: host-given port/token binding with
// ephemeral fallback, and the shared endpoint-path contract.
import { createServer } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { RelayAgentHookServer } from './agent-hook-server'
import {
  wslHookRelayEndpointDir,
  wslHookRelayEndpointFilePath
} from '../shared/wsl-hook-relay-contract'

describe('RelayAgentHookServer host-given coordinates (WSL relay)', () => {
  let tmpDir: string
  let server: RelayAgentHookServer | null

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'wsl-hook-relay-'))
    server = null
  })

  afterEach(() => {
    server?.stop()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('binds the preferred port with the fixed token when the port is free', async () => {
    const probe = createServer()
    const freePort = await new Promise<number>((resolve) => {
      probe.listen(0, '127.0.0.1', () => {
        const address = probe.address()
        resolve(typeof address === 'object' && address ? address.port : 0)
      })
    })
    await new Promise<void>((resolve) => probe.close(() => resolve()))

    server = new RelayAgentHookServer({
      endpointDir: tmpDir,
      token: 'host-issued-token',
      preferredPort: freePort,
      forward: () => {}
    })
    await server.start()

    expect(server.getCoordinates().port).toBe(freePort)
    expect(server.getCoordinates().token).toBe('host-issued-token')
    expect(server.usedPortFallback).toBe(false)
  })

  it('falls back to an ephemeral port when the preferred port is occupied', async () => {
    const occupant = createServer()
    const occupiedPort = await new Promise<number>((resolve) => {
      occupant.listen(0, '127.0.0.1', () => {
        const address = occupant.address()
        resolve(typeof address === 'object' && address ? address.port : 0)
      })
    })
    try {
      server = new RelayAgentHookServer({
        endpointDir: tmpDir,
        token: 'host-issued-token',
        preferredPort: occupiedPort,
        forward: () => {}
      })
      await server.start()

      expect(server.usedPortFallback).toBe(true)
      const bound = server.getCoordinates().port
      expect(bound).toBeGreaterThan(0)
      expect(bound).not.toBe(occupiedPort)
      // Fallback still authenticates with the host-issued token.
      expect(server.getCoordinates().token).toBe('host-issued-token')
    } finally {
      await new Promise<void>((resolve) => occupant.close(() => resolve()))
    }
  })

  it('keeps random-token ephemeral behavior when no coordinates are given (SSH shape)', async () => {
    server = new RelayAgentHookServer({ endpointDir: tmpDir, forward: () => {} })
    await server.start()
    expect(server.getCoordinates().port).toBeGreaterThan(0)
    expect(server.getCoordinates().token).toMatch(/^[0-9a-f-]{36}$/)
    expect(server.usedPortFallback).toBe(false)
  })
})

describe('wsl hook relay endpoint contract', () => {
  it('derives the endpoint dir from guest home and the Windows port', () => {
    expect(wslHookRelayEndpointDir('/home/u', 43117)).toBe(
      '/home/u/.orca-wsl/agent-hooks/port-43117'
    )
    expect(wslHookRelayEndpointDir('/home/u/', 43117)).toBe(
      '/home/u/.orca-wsl/agent-hooks/port-43117'
    )
  })

  it('names the guest endpoint file endpoint.env regardless of host platform', () => {
    expect(wslHookRelayEndpointFilePath('/home/u', 1)).toBe(
      '/home/u/.orca-wsl/agent-hooks/port-1/endpoint.env'
    )
  })
})

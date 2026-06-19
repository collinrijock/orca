import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import type * as Os from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Why: opening Settings renders the Bitbucket card, which triggers the preflight
// status (getBitbucketAuthStatus) and the card's status IPC
// (getBitbucketConnectionStatus). Neither must decrypt the stored secret, or the
// OS would prompt the user to unlock the keychain every time Settings opens.
// This test simulates a cold app session (files on disk, in-memory cache empty)
// and asserts safeStorage.decryptString is never touched by those reads.

const decryptSpy = vi.fn((value: Buffer) => value.toString('utf-8'))
const OLD_ENV = process.env
let tempHome = ''

vi.mock('../git/runner', () => ({ gitExecFileAsync: vi.fn() }))

async function loadModules() {
  vi.resetModules()
  vi.doMock('electron', () => ({
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(value),
      decryptString: decryptSpy
    }
  }))
  vi.doMock('os', async () => {
    const actual = await vi.importActual<typeof Os>('os')
    return { ...actual, homedir: () => tempHome }
  })
  const store = await import('./credential-store')
  const client = await import('./client')
  const connection = await import('./credential-connection')
  return { store, client, connection }
}

beforeEach(() => {
  process.env = { ...OLD_ENV }
  for (const key of [
    'ORCA_BITBUCKET_ACCESS_TOKEN',
    'ORCA_BITBUCKET_EMAIL',
    'ORCA_BITBUCKET_API_TOKEN',
    'ORCA_BITBUCKET_API_BASE_URL'
  ]) {
    delete process.env[key]
  }
  tempHome = mkdtempSync(join(tmpdir(), 'orca-bb-nodecrypt-'))
  decryptSpy.mockClear()
})

afterEach(() => {
  process.env = OLD_ENV
})

describe('Bitbucket status reads never decrypt the stored secret', () => {
  it('renders connected state from plaintext metadata without touching the keychain', async () => {
    const { store, client, connection } = await loadModules()
    store.saveBitbucketCredential({
      authMode: 'basic',
      email: 'ada@example.com',
      baseUrl: null,
      account: 'ada',
      accessToken: null,
      apiToken: 'secret-token'
    })

    // Simulate relaunch: secret file is on disk but the in-memory cache is cold,
    // so a decryption here would surface as a keychain prompt.
    store._resetBitbucketCredentialCache()
    decryptSpy.mockClear()

    const auth = await client.getBitbucketAuthStatus()
    const status = connection.getBitbucketConnectionStatus()

    expect(auth).toEqual({ configured: true, authenticated: true, account: 'ada' })
    expect(status).toMatchObject({ source: 'stored', account: 'ada', authMode: 'basic' })
    expect(decryptSpy).not.toHaveBeenCalled()
  })
})

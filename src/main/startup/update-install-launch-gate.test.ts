import { mkdtempSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  UPDATE_INSTALL_HANDOFF_MARKER_FILE,
  UPDATE_INSTALL_HANDOFF_MAX_AGE_MS,
  clearUpdateInstallHandoffMarker,
  isBundleShipItRunning,
  shouldDeferLaunchForUpdateInstall,
  writeUpdateInstallHandoffMarker
} from './update-install-launch-gate'

const APP_BIN = '/Applications/Orca.app/Contents/MacOS/Orca'
const SHIPIT_ROW =
  '/Applications/Orca.app/Contents/Frameworks/Squirrel.framework/Resources/ShipIt com.stablyai.orca.ShipIt'

const tempDirs: string[] = []

function makeUserData(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'orca-launch-gate-'))
  tempDirs.push(dir)
  return dir
}

function markerFile(userData: string): string {
  return path.join(userData, UPDATE_INSTALL_HANDOFF_MARKER_FILE)
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('isBundleShipItRunning', () => {
  it('matches only this bundle’s Squirrel installer', () => {
    const otherBundle =
      '/Applications/Other.app/Contents/Frameworks/Squirrel.framework/Resources/ShipIt'
    expect(isBundleShipItRunning(APP_BIN, `${otherBundle}\n/usr/bin/ps`)).toBe(false)
    expect(isBundleShipItRunning(APP_BIN, `/usr/bin/ps\n${SHIPIT_ROW}`)).toBe(true)
  })

  it('ignores processes that merely mention the installer path in arguments', () => {
    const grepRow = `/bin/zsh -c grep ${SHIPIT_ROW}`
    expect(isBundleShipItRunning(APP_BIN, grepRow)).toBe(false)
  })
})

describe('shouldDeferLaunchForUpdateInstall', () => {
  it('defers a same-version launch while this bundle’s installer is alive', () => {
    const userData = makeUserData()
    writeUpdateInstallHandoffMarker(userData, '1.0.51')

    const defer = shouldDeferLaunchForUpdateInstall({
      isPackaged: true,
      userDataPath: userData,
      appVersion: '1.0.51',
      deps: { platform: 'darwin', executablePath: APP_BIN, readProcessList: () => SHIPIT_ROW }
    })

    expect(defer).toBe(true)
    expect(existsSync(markerFile(userData))).toBe(true)
  })

  it('lets the post-update relaunch through and clears the marker', () => {
    const userData = makeUserData()
    writeUpdateInstallHandoffMarker(userData, '1.0.51')

    const defer = shouldDeferLaunchForUpdateInstall({
      isPackaged: true,
      userDataPath: userData,
      appVersion: '1.0.61',
      deps: { platform: 'darwin', executablePath: APP_BIN, readProcessList: () => SHIPIT_ROW }
    })

    expect(defer).toBe(false)
    expect(existsSync(markerFile(userData))).toBe(false)
  })

  it('launches normally once the installer has exited (aborted/failed install)', () => {
    const userData = makeUserData()
    writeUpdateInstallHandoffMarker(userData, '1.0.51')

    const defer = shouldDeferLaunchForUpdateInstall({
      isPackaged: true,
      userDataPath: userData,
      appVersion: '1.0.51',
      deps: { platform: 'darwin', executablePath: APP_BIN, readProcessList: () => '/usr/bin/ps' }
    })

    expect(defer).toBe(false)
    expect(existsSync(markerFile(userData))).toBe(false)
  })

  it('expires stale markers instead of gating launches', () => {
    const userData = makeUserData()
    const staleCreatedAt = 1_000_000
    writeUpdateInstallHandoffMarker(userData, '1.0.51', staleCreatedAt)

    const defer = shouldDeferLaunchForUpdateInstall({
      isPackaged: true,
      userDataPath: userData,
      appVersion: '1.0.51',
      deps: {
        platform: 'darwin',
        executablePath: APP_BIN,
        now: staleCreatedAt + UPDATE_INSTALL_HANDOFF_MAX_AGE_MS + 1,
        readProcessList: () => SHIPIT_ROW
      }
    })

    expect(defer).toBe(false)
    expect(existsSync(markerFile(userData))).toBe(false)
  })

  it('fails open on corrupt markers, unreadable process tables, and other platforms', () => {
    const userData = makeUserData()
    writeFileSync(markerFile(userData), 'not json')
    expect(
      shouldDeferLaunchForUpdateInstall({
        isPackaged: true,
        userDataPath: userData,
        appVersion: '1.0.51',
        deps: { platform: 'darwin', executablePath: APP_BIN, readProcessList: () => SHIPIT_ROW }
      })
    ).toBe(false)

    writeUpdateInstallHandoffMarker(userData, '1.0.51')
    expect(
      shouldDeferLaunchForUpdateInstall({
        isPackaged: true,
        userDataPath: userData,
        appVersion: '1.0.51',
        deps: {
          platform: 'darwin',
          executablePath: APP_BIN,
          readProcessList: () => {
            throw new Error('ps timed out')
          }
        }
      })
    ).toBe(false)

    writeUpdateInstallHandoffMarker(userData, '1.0.51')
    expect(
      shouldDeferLaunchForUpdateInstall({
        isPackaged: true,
        userDataPath: userData,
        appVersion: '1.0.51',
        deps: { platform: 'win32', executablePath: APP_BIN, readProcessList: () => SHIPIT_ROW }
      })
    ).toBe(false)

    expect(
      shouldDeferLaunchForUpdateInstall({
        isPackaged: false,
        userDataPath: userData,
        appVersion: '1.0.51',
        deps: { platform: 'darwin', executablePath: APP_BIN, readProcessList: () => SHIPIT_ROW }
      })
    ).toBe(false)
  })

  it('clearUpdateInstallHandoffMarker removes the marker', () => {
    const userData = makeUserData()
    writeUpdateInstallHandoffMarker(userData, '1.0.51')
    clearUpdateInstallHandoffMarker(userData)
    expect(existsSync(markerFile(userData))).toBe(false)
  })
})

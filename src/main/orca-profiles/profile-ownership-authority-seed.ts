import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname } from 'node:path'
import { getDefaultPersistedState } from '../../shared/constants'
import type { GlobalSettings } from '../../shared/types'
import { withDaemonOwnershipCommit } from '../daemon/daemon-ownership-commit'
import { getOrcaProfileDataFile, getProfileUserDataPath } from './profile-storage-paths'

export function ensureProfileOwnershipAuthority(profileId: string, userDataPath: string): void {
  writeCommittedSeedIfMissing(profileId, userDataPath)
}

// Why: a new profile must preserve consent without creating an unsigned state
// file that makes the shared ownership snapshot permanently incomplete.
export function seedNewOrcaProfileTelemetryConsent(
  profileId: string,
  telemetry: GlobalSettings['telemetry'],
  userDataPath = getProfileUserDataPath()
): void {
  writeCommittedSeedIfMissing(profileId, userDataPath, telemetry)
}

function writeCommittedSeedIfMissing(
  profileId: string,
  userDataPath: string,
  telemetry?: GlobalSettings['telemetry']
): void {
  const dataFile = getOrcaProfileDataFile(profileId, userDataPath)
  if (existsSync(dataFile)) {
    return
  }
  mkdirSync(dirname(dataFile), { recursive: true })
  const tmpPath = `${dataFile}.tmp`
  const defaults = getDefaultPersistedState(homedir())
  const state = telemetry
    ? { ...defaults, settings: { ...defaults.settings, telemetry } }
    : defaults
  // Why: index initialization makes absence meaningful, so its seed must carry
  // checksum authority before the profile can be marked initialized.
  writeFileSync(
    tmpPath,
    JSON.stringify(withDaemonOwnershipCommit(state, Math.max(1, Date.now())), null, 2),
    'utf8'
  )
  renameSync(tmpPath, dataFile)
}

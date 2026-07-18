import { getProfileUserDataPath } from './profile-storage-paths'
import {
  getOrcaProfileIndexPath,
  loadOrCreateProfileIndex,
  writeProfileIndex
} from './profile-index-store'
import { ensureProfileOwnershipAuthority } from './profile-ownership-authority-seed'

export function markOrcaProfileInitialized(
  profileId: string,
  userDataPath = getProfileUserDataPath()
): void {
  const index = loadOrCreateProfileIndex(userDataPath)
  const profile = index.profiles.find((candidate) => candidate.id === profileId)
  if (!profile) {
    throw new Error('unknown_orca_profile')
  }
  if (profile.initialized === true) {
    return
  }
  // Why: initialized makes a missing state authoritative, so commit a complete
  // empty profile before exposing that bit to cross-profile ownership reads.
  ensureProfileOwnershipAuthority(profileId, userDataPath)
  // Why: the index must stop treating missing state as authoritative emptiness
  // before an offline transfer can place live daemon claims in that profile.
  writeProfileIndex(getOrcaProfileIndexPath(userDataPath), {
    ...index,
    profiles: index.profiles.map((candidate) =>
      candidate.id === profileId ? { ...candidate, initialized: true } : candidate
    )
  })
}

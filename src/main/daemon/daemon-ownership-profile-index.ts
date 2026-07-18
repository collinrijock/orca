export const OWNERSHIP_PROFILE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

export type OwnershipProfileIndexRow = { id: string; initialized: boolean | null }

export function parseOwnershipProfileIndex(
  raw: string
): { activeProfileId: string; rows: OwnershipProfileIndexRow[] } | null {
  try {
    const value = JSON.parse(raw) as unknown
    if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.profiles)) {
      return null
    }
    const rows: OwnershipProfileIndexRow[] = []
    const ids = new Set<string>()
    for (const profile of value.profiles) {
      if (!isValidProfileSummary(profile) || ids.has(profile.id)) {
        return null
      }
      ids.add(profile.id)
      rows.push({
        id: profile.id,
        initialized: typeof profile.initialized === 'boolean' ? profile.initialized : null
      })
    }
    if (typeof value.activeProfileId !== 'string' || !ids.has(value.activeProfileId)) {
      return null
    }
    return { activeProfileId: value.activeProfileId, rows }
  } catch {
    return null
  }
}

function isValidProfileSummary(value: unknown): value is Record<string, unknown> & { id: string } {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    OWNERSHIP_PROFILE_ID_PATTERN.test(value.id) &&
    typeof value.name === 'string' &&
    (value.kind === 'local' || value.kind === 'cloud-linked') &&
    Number.isFinite(value.createdAt) &&
    Number.isFinite(value.updatedAt) &&
    Number.isFinite(value.lastOpenedAt) &&
    isRecord(value.avatar)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

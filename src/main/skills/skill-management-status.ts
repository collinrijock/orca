import type { SkillManagementStatus } from '../../shared/skill-management'

export function knownSkillManagementStatus(
  managed: boolean,
  installedRevision: number,
  currentRevision: number
): SkillManagementStatus {
  if (installedRevision > currentRevision) {
    return 'newer-known'
  }
  if (installedRevision < currentRevision) {
    return managed ? 'managed-update-available' : 'known-update-available'
  }
  return managed ? 'managed-current' : 'known-current'
}

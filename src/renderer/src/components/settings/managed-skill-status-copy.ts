import type {
  SkillManagementInstallation,
  SkillManagementStatus,
  SkillReplacementPreview
} from '../../../../shared/skill-management'
import { translate } from '@/i18n/i18n'

export function managedSkillStatusCopy(status: SkillManagementStatus): string {
  switch (status) {
    case 'managed-current':
      return translate('auto.components.settings.ManagedOrcaSkills.managedCurrent', 'Up to date')
    case 'managed-update-available':
      return translate(
        'auto.components.settings.ManagedOrcaSkills.managedUpdate',
        'Update available'
      )
    case 'known-current':
      return translate(
        'auto.components.settings.ManagedOrcaSkills.availableToManage',
        'Not tracked'
      )
    case 'known-update-available':
      return translate(
        'auto.components.settings.ManagedOrcaSkills.manageAndUpdate',
        'Update available'
      )
    case 'newer-known':
      return translate('auto.components.settings.ManagedOrcaSkills.newerKnown', 'Newer than Orca')
    case 'modified':
      return translate('auto.components.settings.ManagedOrcaSkills.modified', 'Local changes')
    case 'unknown':
      return translate('auto.components.settings.ManagedOrcaSkills.unknown', 'Unrecognized')
    case 'externally-managed':
      return translate('auto.components.settings.ManagedOrcaSkills.external', 'Managed elsewhere')
    case 'inaccessible':
      return translate('auto.components.settings.ManagedOrcaSkills.inaccessible', 'Inaccessible')
    case 'update-failed':
      return translate('auto.components.settings.ManagedOrcaSkills.failed', 'Update failed')
  }
}

export function managedSkillSummaryCopy(
  installation: Pick<SkillManagementInstallation, 'status'>
): string {
  switch (installation.status) {
    case 'managed-current':
      return translate(
        'auto.components.settings.ManagedOrcaSkills.summaryManagedCurrent',
        'Orca is tracking this skill for new versions.'
      )
    case 'known-current':
      return translate(
        'auto.components.settings.ManagedOrcaSkills.summaryKnownCurrent',
        'This installed copy matches Orca’s current version.'
      )
    case 'known-update-available':
    case 'managed-update-available':
      return translate(
        'auto.components.settings.ManagedOrcaSkills.summaryUpdateAvailable',
        'A newer official version is ready to install.'
      )
    case 'newer-known':
      return translate(
        'auto.components.settings.ManagedOrcaSkills.summaryNewerKnown',
        'This installed copy is newer than the version bundled with Orca.'
      )
    case 'modified':
      return translate(
        'auto.components.settings.ManagedOrcaSkills.summaryModified',
        'This installed copy has local changes. Review them before replacing it.'
      )
    case 'unknown':
      return translate(
        'auto.components.settings.ManagedOrcaSkills.summaryUnknown',
        'This installed copy does not match a known Orca version.'
      )
    case 'externally-managed':
      return translate(
        'auto.components.settings.ManagedOrcaSkills.summaryExternal',
        'Another installer controls this copy, so Orca will not change it.'
      )
    case 'inaccessible':
      return translate(
        'auto.components.settings.ManagedOrcaSkills.summaryInaccessible',
        'Orca could not read this installed copy.'
      )
    case 'update-failed':
      return translate(
        'auto.components.settings.ManagedOrcaSkills.summaryFailed',
        'The last update failed. Your previous copy was kept.'
      )
  }
}

export function managedSkillDisplayName(name: string): string {
  const preferredWords: Record<string, string> = { orca: 'Orca', cli: 'CLI' }
  return name
    .split('-')
    .map((word) => preferredWords[word] ?? `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(' ')
}

export function managedSkillReplacementChangeCopy(
  change: SkillReplacementPreview['files'][number]['change']
): string {
  switch (change) {
    case 'added':
      return translate('auto.components.settings.ManagedOrcaSkills.changeAdded', 'Added')
    case 'removed':
      return translate('auto.components.settings.ManagedOrcaSkills.changeRemoved', 'Removed')
    case 'modified':
      return translate('auto.components.settings.ManagedOrcaSkills.changeModified', 'Modified')
  }
}

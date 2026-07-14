import type {
  SkillFreshnessInstallation,
  SkillFreshnessStatus,
  SkillInstallationTopology
} from '../../../../shared/skill-freshness'
import { SUPPORTED_GLOBAL_SKILL_TOPOLOGIES } from '../../../../shared/skill-freshness'
import { translate } from '@/i18n/i18n'
import { Badge } from '@/components/ui/badge'

export function statusLabel(status: SkillFreshnessStatus): string {
  switch (status) {
    case 'current':
      return translate('auto.components.skills.SkillFreshnessRow.current', 'Current')
    case 'outdated':
      return translate('auto.components.skills.SkillFreshnessRow.outdated', 'Update available')
    case 'newer-known':
      return translate('auto.components.skills.SkillFreshnessRow.newerKnown', 'Newer known copy')
    case 'unrecognized':
      return translate('auto.components.skills.SkillFreshnessRow.unrecognized', 'Unrecognized')
    case 'inaccessible':
      return translate('auto.components.skills.SkillFreshnessRow.inaccessible', 'Inaccessible')
  }
}

export function topologyLabel(topology: SkillInstallationTopology): string | null {
  switch (topology) {
    case 'canonical-copy':
      return null
    case 'provider-alias':
      return translate('auto.components.skills.SkillFreshnessRow.providerAlias', 'Provider alias')
    case 'independent-copy':
      return translate('auto.components.skills.SkillFreshnessRow.independentCopy', 'Provider copy')
    case 'external-link':
      return translate('auto.components.skills.SkillFreshnessRow.externalLink', 'External link')
    case 'broken-link':
      return translate('auto.components.skills.SkillFreshnessRow.brokenLink', 'Broken link')
    case 'read-only':
      return translate('auto.components.skills.SkillFreshnessRow.readOnly', 'Read only')
    case 'repo-scope':
      return translate('auto.components.skills.SkillFreshnessRow.repoScope', 'Repository scope')
    case 'plugin-cache':
      return translate('auto.components.skills.SkillFreshnessRow.pluginCache', 'Plugin cache')
  }
}

export function statusDescription(
  installation: SkillFreshnessInstallation,
  eligibleNames: ReadonlySet<string>
): string {
  switch (installation.status) {
    case 'current':
      return translate(
        'auto.components.skills.SkillFreshnessRow.currentDescription',
        'Exactly matches the version bundled with this Orca build.'
      )
    case 'outdated':
      if (eligibleNames.has(installation.name)) {
        return translate(
          'auto.components.skills.SkillFreshnessRow.outdatedDescription',
          'Exactly matches an older official Orca snapshot.'
        )
      }
      // Why: the block can come from this row's own unsupported placement or from
      // a sibling placement of the same name; blaming a phantom sibling misleads.
      return SUPPORTED_GLOBAL_SKILL_TOPOLOGIES.has(installation.topology)
        ? translate(
            'auto.components.skills.SkillFreshnessRow.outdatedBlockedDescription',
            'An older official copy was found, but another placement of this name prevents a safe global update.'
          )
        : translate(
            'auto.components.skills.SkillFreshnessRow.outdatedUnsupportedPlacementDescription',
            'An older official copy was found, but this placement cannot be updated safely in place.'
          )
    case 'newer-known':
      return translate(
        'auto.components.skills.SkillFreshnessRow.newerKnownDescription',
        'Matches a known revision newer than this Orca build. No update is offered.'
      )
    case 'unrecognized':
      return translate(
        'auto.components.skills.SkillFreshnessRow.unrecognizedDescription',
        'May be edited or from another source. Orca will not update it.'
      )
    case 'inaccessible':
      return translate(
        'auto.components.skills.SkillFreshnessRow.inaccessibleDescription',
        'Orca could not inspect this placement. No update is offered.'
      )
  }
}

export function FreshnessRow({
  installation,
  eligibleNames
}: {
  installation: SkillFreshnessInstallation
  eligibleNames: ReadonlySet<string>
}): React.JSX.Element {
  const topology = topologyLabel(installation.topology)
  return (
    <div className="space-y-1.5 py-3 first:pt-0 last:pb-0">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-foreground">{installation.name}</span>
        <Badge variant={installation.status === 'outdated' ? 'secondary' : 'outline'}>
          {statusLabel(installation.status)}
        </Badge>
        {topology ? <Badge variant="outline">{topology}</Badge> : null}
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        {statusDescription(installation, eligibleNames)}
      </p>
      <p
        className="truncate font-mono text-[11px] text-muted-foreground"
        title={installation.unresolvedPath}
      >
        {installation.unresolvedPath}
      </p>
    </div>
  )
}

import type { SkillFreshnessGroupModel, SkillLocationChip } from './skill-freshness-grouping'
import { translate } from '@/i18n/i18n'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

function chipLabel(chip: SkillLocationChip): string {
  switch (chip) {
    case 'current':
      return translate('auto.components.skills.SkillFreshnessRow.chipCurrent', 'Current')
    case 'unrecognized':
      return translate('auto.components.skills.SkillFreshnessRow.chipUnrecognized', 'Unrecognized')
    case 'inaccessible':
      return translate('auto.components.skills.SkillFreshnessRow.chipInaccessible', 'Inaccessible')
    case 'duplicate':
      return translate('auto.components.skills.SkillFreshnessRow.chipDuplicate', 'Duplicate')
    case 'external-link':
      return translate('auto.components.skills.SkillFreshnessRow.chipExternalLink', 'External link')
    case 'broken-link':
      return translate('auto.components.skills.SkillFreshnessRow.chipBrokenLink', 'Broken link')
    case 'read-only':
      return translate('auto.components.skills.SkillFreshnessRow.chipReadOnly', 'Read only')
    case 'in-a-repo':
      return translate('auto.components.skills.SkillFreshnessRow.chipInRepo', 'In a repo')
    case 'plugin-cache':
      return translate('auto.components.skills.SkillFreshnessRow.chipPluginCache', 'Plugin cache')
  }
}

function chipTooltip(chip: SkillLocationChip): string {
  switch (chip) {
    case 'current':
      return translate(
        'auto.components.skills.SkillFreshnessRow.tipCurrent',
        'The skill here is already up to date — the update won’t change it.'
      )
    case 'unrecognized':
      return translate(
        'auto.components.skills.SkillFreshnessRow.tipUnrecognized',
        'The contents of the skill here don’t match any official version, so Orca can’t update it safely. Remove or replace what’s here to allow updates.'
      )
    case 'inaccessible':
      return translate(
        'auto.components.skills.SkillFreshnessRow.tipInaccessible',
        'Orca couldn’t read the skill here (a permissions or file error), so it can’t check or update it.'
      )
    case 'duplicate':
      return translate(
        'auto.components.skills.SkillFreshnessRow.tipDuplicate',
        'The skill is also installed here, separately from the main one, so the npx skills update command can’t reach it. Remove it to allow updates.'
      )
    case 'external-link':
      return translate(
        'auto.components.skills.SkillFreshnessRow.tipExternalLink',
        'This is a shortcut pointing outside Orca’s skill folders; the update won’t follow it.'
      )
    case 'broken-link':
      return translate(
        'auto.components.skills.SkillFreshnessRow.tipBrokenLink',
        'This is a shortcut to something that no longer exists — you can safely delete it.'
      )
    case 'read-only':
      return translate(
        'auto.components.skills.SkillFreshnessRow.tipReadOnly',
        'The skill here is in a read-only location, so it can’t be updated until you change its permissions.'
      )
    case 'in-a-repo':
      return translate(
        'auto.components.skills.SkillFreshnessRow.tipInRepo',
        'The skill here lives inside a project, not your global skills — Orca only updates global ones.'
      )
    case 'plugin-cache':
      return translate(
        'auto.components.skills.SkillFreshnessRow.tipPluginCache',
        'The skill here is managed by a plugin — update the plugin instead.'
      )
  }
}

export function SkillFreshnessGroup({
  group
}: {
  group: SkillFreshnessGroupModel
}): React.JSX.Element {
  const isBlocked = group.status === 'cannot-update'
  return (
    <div className="space-y-2 py-3 first:pt-0 last:pb-0">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-foreground">{group.name}</span>
        {isBlocked ? (
          <Badge
            variant="outline"
            className="border-amber-600/50 text-amber-700 dark:border-amber-400/40 dark:text-amber-400"
          >
            {translate('auto.components.skills.SkillFreshnessRow.statusCantUpdate', 'Can’t update')}
          </Badge>
        ) : (
          <Badge variant="secondary">
            {translate(
              'auto.components.skills.SkillFreshnessRow.statusUpdateAvailable',
              'Update available'
            )}
          </Badge>
        )}
      </div>
      {isBlocked ? (
        <p className="text-xs leading-5 text-muted-foreground">
          {translate(
            'auto.components.skills.SkillFreshnessRow.cantUpdateReason',
            'This skill is installed somewhere Orca can’t safely update, so the npx skills update command leaves it alone.'
          )}
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        {group.locations.map((location) => (
          <div
            key={location.id}
            className="flex min-w-0 flex-wrap items-center gap-2 border-l-2 border-border/60 pl-3"
          >
            <span
              className="truncate font-mono text-[11px] text-muted-foreground"
              title={location.path}
            >
              {location.path}
            </span>
            {location.chip ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="cursor-help border-dashed">
                    {chipLabel(location.chip)}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-pretty">
                  {chipTooltip(location.chip)}
                </TooltipContent>
              </Tooltip>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}

import React from 'react'
import { List, ListTree, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { GlobalSettings, SourceControlViewMode } from '../../../../shared/types'

type SourceControlViewModeEducationSettings = Pick<
  GlobalSettings,
  'sourceControlViewModeEducationDismissed'
>

export function shouldShowSourceControlViewModeEducation(
  settings: SourceControlViewModeEducationSettings | null | undefined
): boolean {
  return settings?.sourceControlViewModeEducationDismissed === false
}

export function createSourceControlViewModeEducationChoiceUpdate(
  mode: SourceControlViewMode
): Pick<GlobalSettings, 'sourceControlViewMode' | 'sourceControlViewModeEducationDismissed'> {
  return {
    sourceControlViewMode: mode,
    sourceControlViewModeEducationDismissed: true
  }
}

export function createSourceControlViewModeEducationDismissUpdate(): Pick<
  GlobalSettings,
  'sourceControlViewModeEducationDismissed'
> {
  return { sourceControlViewModeEducationDismissed: true }
}

export function SourceControlViewModeEducation({
  sourceControlViewMode,
  disabled,
  onChooseViewMode,
  onDismiss
}: {
  sourceControlViewMode: SourceControlViewMode
  disabled: boolean
  onChooseViewMode: (mode: SourceControlViewMode) => void
  onDismiss: () => void
}): React.JSX.Element {
  return (
    <div className="border-b border-border bg-muted/40 px-3 py-2">
      <div className="flex min-w-0 items-start gap-2">
        <ListTree className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-xs leading-5 text-foreground">
            {translate(
              'auto.components.right.sidebar.SourceControl.d4e8a6f312',
              'Group Source Control files by folder or keep one flat list. Change this later from More actions.'
            )}
          </p>
          <div className="flex min-w-0 flex-wrap gap-1.5">
            <Button
              type="button"
              size="xs"
              variant={sourceControlViewMode === 'tree' ? 'secondary' : 'outline'}
              disabled={disabled}
              onClick={() => onChooseViewMode('tree')}
            >
              <ListTree className="size-3.5" aria-hidden="true" />
              {translate('auto.components.right.sidebar.SourceControl.e7a9f63a12', 'Use tree')}
            </Button>
            <Button
              type="button"
              size="xs"
              variant={sourceControlViewMode === 'list' ? 'secondary' : 'outline'}
              disabled={disabled}
              onClick={() => onChooseViewMode('list')}
            >
              <List className="size-3.5" aria-hidden="true" />
              {translate('auto.components.right.sidebar.SourceControl.f3b91c50a4', 'Use list')}
            </Button>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
          disabled={disabled}
          onClick={onDismiss}
          aria-label={translate(
            'auto.components.right.sidebar.SourceControl.ccd4a812af',
            'Dismiss view options'
          )}
        >
          <X className="size-3.5" aria-hidden="true" />
        </Button>
      </div>
    </div>
  )
}

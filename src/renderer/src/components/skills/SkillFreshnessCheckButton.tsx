import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { requestSkillFreshnessUpdateDialog } from './skill-freshness-update-dialog'

// Compact re-entry point for the freshness update dialog, mounted at App root.
// Works even when nothing is outdated: the dialog then shows the up-to-date or
// diagnostic state.
export function SkillFreshnessCheckButton({
  className
}: {
  className?: string
}): React.JSX.Element {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={className}
      onClick={() => requestSkillFreshnessUpdateDialog()}
    >
      <RefreshCw className="size-3.5" />
      {translate(
        'auto.components.skills.SkillFreshnessCheckButton.label',
        'Check for skill updates'
      )}
    </Button>
  )
}

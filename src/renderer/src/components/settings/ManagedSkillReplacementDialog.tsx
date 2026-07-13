import { Loader2 } from 'lucide-react'
import type { SkillReplacementPreview } from '../../../../shared/skill-management'
import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'
import { SettingsBadge } from './SettingsFormControls'
import {
  managedSkillDisplayName,
  managedSkillReplacementChangeCopy
} from './managed-skill-status-copy'

export function ManagedSkillReplacementDialog({
  preview,
  busy,
  onClose,
  onConfirm
}: {
  preview: SkillReplacementPreview
  busy: boolean
  onClose: () => void
  onConfirm: () => void
}): React.JSX.Element {
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-3xl" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>
            {translate(
              'auto.components.settings.ManagedOrcaSkills.replaceTitle',
              'Review local changes to {{value0}}',
              { value0: managedSkillDisplayName(preview.skillName) }
            )}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.settings.ManagedOrcaSkills.replaceDescription',
              'Using Orca’s official version will remove the local changes below. Orca keeps a temporary backup until the replacement succeeds.'
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="scrollbar-sleek max-h-[55vh] space-y-3 overflow-y-auto rounded-md border border-border bg-muted/20 p-3">
          {preview.files.map((file) => (
            <div key={file.path} className="space-y-2">
              <div className="flex items-center gap-2">
                <code className="font-mono text-xs text-foreground">{file.path}</code>
                <SettingsBadge tone="muted">
                  {managedSkillReplacementChangeCopy(file.change)}
                </SettingsBadge>
              </div>
              {file.beforeText !== null || file.afterText !== null ? (
                <div className="grid gap-2 md:grid-cols-2">
                  <div className="space-y-1">
                    <p className="text-[11px] font-semibold tracking-[0.05em] text-muted-foreground uppercase">
                      {translate(
                        'auto.components.settings.ManagedOrcaSkills.yourCopy',
                        'Your copy'
                      )}
                    </p>
                    <pre className="scrollbar-sleek max-h-48 overflow-auto rounded-md border border-border bg-background p-2 font-mono text-[11px] whitespace-pre-wrap text-muted-foreground">
                      {file.beforeText ?? '—'}
                    </pre>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[11px] font-semibold tracking-[0.05em] text-muted-foreground uppercase">
                      {translate(
                        'auto.components.settings.ManagedOrcaSkills.officialCopy',
                        'Official version'
                      )}
                    </p>
                    <pre className="scrollbar-sleek max-h-48 overflow-auto rounded-md border border-border bg-background p-2 font-mono text-[11px] whitespace-pre-wrap text-muted-foreground">
                      {file.afterText ?? '—'}
                    </pre>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {translate(
                    'auto.components.settings.ManagedOrcaSkills.binaryChange',
                    'Binary file contents differ.'
                  )}
                </p>
              )}
            </div>
          ))}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={busy}>
              {translate('auto.components.settings.ManagedOrcaSkills.cancel', 'Cancel')}
            </Button>
          </DialogClose>
          <Button variant="destructive" disabled={busy} onClick={onConfirm}>
            {busy ? <Loader2 className="animate-spin" /> : null}
            {translate(
              'auto.components.settings.ManagedOrcaSkills.replace',
              'Use official version'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

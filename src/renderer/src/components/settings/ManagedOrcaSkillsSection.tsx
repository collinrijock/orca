import { useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import type {
  SkillManagementInstallation,
  SkillManagementStatus,
  SkillReplacementPreview
} from '../../../../shared/skill-management'
import { useManagedAgentSkills } from '@/hooks/useManagedAgentSkills'
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
import { SettingsBadge, SettingsSubsectionHeader } from './SettingsFormControls'
import { managedSkillDiagnosticCopy, managedSkillStatusCopy } from './managed-skill-status-copy'

function statusTone(
  status: SkillManagementStatus
): React.ComponentProps<typeof SettingsBadge>['tone'] {
  switch (status) {
    case 'managed-current':
      return 'accent'
    case 'known-current':
    case 'known-update-available':
    case 'managed-update-available':
      return 'muted'
    case 'newer-known':
    case 'modified':
    case 'unknown':
    case 'externally-managed':
    case 'inaccessible':
    case 'update-failed':
      return 'muted'
  }
}

function missingVisibilityCopy(installation: SkillManagementInstallation): string | null {
  if (!installation.managed) {
    return null
  }
  const missing = [
    !installation.providers.includes('codex') ? 'Codex' : null,
    !installation.providers.includes('claude') ? 'Claude' : null
  ].filter((provider): provider is string => provider !== null)
  return missing.length > 0
    ? translate(
        'auto.components.settings.ManagedOrcaSkills.notVisible',
        'Managed but not visible in {{value0}}.',
        { value0: missing.join(', ') }
      )
    : null
}

function ReplacementDialog({
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
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {translate(
              'auto.components.settings.ManagedOrcaSkills.replaceTitle',
              'Replace {{value0}}?',
              { value0: preview.skillName }
            )}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.settings.ManagedOrcaSkills.replaceDescription',
              'This discards the local changes shown below. Orca keeps a rollback copy until the bundled skill is verified.'
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="scrollbar-sleek max-h-[55vh] space-y-3 overflow-y-auto rounded-md border border-border bg-muted/20 p-3">
          {preview.files.map((file) => (
            <div key={file.path} className="space-y-2">
              <div className="flex items-center gap-2">
                <code className="font-mono text-xs text-foreground">{file.path}</code>
                <SettingsBadge tone="muted">{file.change}</SettingsBadge>
              </div>
              {file.beforeText !== null || file.afterText !== null ? (
                <div className="grid gap-2 md:grid-cols-2">
                  <pre className="scrollbar-sleek max-h-48 overflow-auto rounded-md border border-border bg-background p-2 font-mono text-[11px] whitespace-pre-wrap text-muted-foreground">
                    {file.beforeText ?? '—'}
                  </pre>
                  <pre className="scrollbar-sleek max-h-48 overflow-auto rounded-md border border-border bg-background p-2 font-mono text-[11px] whitespace-pre-wrap text-muted-foreground">
                    {file.afterText ?? '—'}
                  </pre>
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
            {translate('auto.components.settings.ManagedOrcaSkills.replace', 'Replace skill')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ManagedOrcaSkillsSection(): React.JSX.Element {
  const state = useManagedAgentSkills()
  const [preview, setPreview] = useState<SkillReplacementPreview | null>(null)

  const reportFailure = (error: unknown): void => {
    toast.error(
      error instanceof Error
        ? error.message
        : translate(
            'auto.components.settings.ManagedOrcaSkills.actionFailed',
            'Skill action failed.'
          )
    )
  }

  const reviewReplacement = async (installationId: string): Promise<void> => {
    try {
      setPreview(await state.previewReplacement(installationId))
    } catch (error) {
      reportFailure(error)
    }
  }

  const run = async (action: () => Promise<void>, success: string): Promise<boolean> => {
    try {
      await action()
      toast.success(success)
      return true
    } catch (error) {
      reportFailure(error)
      return false
    }
  }

  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={translate('auto.components.settings.ManagedOrcaSkills.title', 'Orca agent skills')}
        description={translate(
          'auto.components.settings.ManagedOrcaSkills.description',
          'Orca updates only exact official copies you explicitly choose to manage.'
        )}
        action={
          <Button
            variant="ghost"
            size="xs"
            disabled={state.loading}
            onClick={() => void state.refresh()}
          >
            <RefreshCw className={state.loading ? 'animate-spin' : undefined} />
            {translate('auto.components.settings.ManagedOrcaSkills.refresh', 'Refresh')}
          </Button>
        }
      />
      {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
      {state.inventory?.installations.length ? (
        <div className="divide-y divide-border/40">
          {state.inventory.installations.map((installation) => {
            const busy = state.busyInstallationId === installation.id
            const visibility = missingVisibilityCopy(installation)
            const replaceable =
              installation.status === 'modified' || installation.status === 'unknown'
            return (
              <div key={installation.id} className="flex items-start gap-4 py-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{installation.name}</span>
                    <SettingsBadge tone={statusTone(installation.status)}>
                      {managedSkillStatusCopy(installation.status)}
                    </SettingsBadge>
                  </div>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    {managedSkillDiagnosticCopy(installation)}
                  </p>
                  {installation.description ? (
                    <p className="text-xs text-muted-foreground">{installation.description}</p>
                  ) : null}
                  <p className="truncate font-mono text-[11px] text-muted-foreground">
                    {installation.unresolvedPath}
                  </p>
                  {visibility ? (
                    <p className="text-[11px] text-muted-foreground">{visibility}</p>
                  ) : null}
                  {!installation.actionsSupported ? (
                    <p className="text-[11px] text-muted-foreground">
                      {translate(
                        'auto.components.settings.ManagedOrcaSkills.hostPending',
                        'Detection only on this host; management actions are not available yet.'
                      )}
                    </p>
                  ) : null}
                </div>
                {!installation.actionsSupported ? null : installation.status === 'known-current' ||
                  installation.status === 'known-update-available' ? (
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => state.manage(installation.id),
                        translate(
                          'auto.components.settings.ManagedOrcaSkills.managedToast',
                          'Skill is now managed and current.'
                        )
                      )
                    }
                  >
                    {busy ? <Loader2 className="animate-spin" /> : null}
                    {installation.status === 'known-update-available'
                      ? translate(
                          'auto.components.settings.ManagedOrcaSkills.manageUpdateAction',
                          'Manage and update'
                        )
                      : translate(
                          'auto.components.settings.ManagedOrcaSkills.manageAction',
                          'Manage'
                        )}
                  </Button>
                ) : installation.status === 'managed-update-available' ||
                  installation.status === 'update-failed' ? (
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => state.update(installation.id),
                        translate(
                          'auto.components.settings.ManagedOrcaSkills.updatedToast',
                          'Skill updated.'
                        )
                      )
                    }
                  >
                    {busy ? <Loader2 className="animate-spin" /> : null}
                    {installation.status === 'update-failed'
                      ? translate('auto.components.settings.ManagedOrcaSkills.retryAction', 'Retry')
                      : translate(
                          'auto.components.settings.ManagedOrcaSkills.updateAction',
                          'Update'
                        )}
                  </Button>
                ) : replaceable ? (
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => void reviewReplacement(installation.id)}
                  >
                    {translate('auto.components.settings.ManagedOrcaSkills.reviewAction', 'Review')}
                  </Button>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : state.loading ? (
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.settings.ManagedOrcaSkills.checking',
            'Checking installed skills…'
          )}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.settings.ManagedOrcaSkills.none',
            'No installed Orca skills found in global agent homes.'
          )}
        </p>
      )}
      {preview ? (
        <ReplacementDialog
          preview={preview}
          busy={state.busyInstallationId === preview.installationId}
          onClose={() => setPreview(null)}
          onConfirm={() =>
            void run(
              () => state.replace(preview.installationId),
              translate(
                'auto.components.settings.ManagedOrcaSkills.replacedToast',
                'Skill replaced with the bundled version.'
              )
            ).then((succeeded) => succeeded && setPreview(null))
          }
        />
      ) : null}
    </section>
  )
}

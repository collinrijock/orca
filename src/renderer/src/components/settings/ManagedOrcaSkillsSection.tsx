import { useRef, useState } from 'react'
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
import { ManagedSkillReplacementDialog } from './ManagedSkillReplacementDialog'
import { SettingsBadge, SettingsSubsectionHeader } from './SettingsFormControls'
import {
  managedSkillDisplayName,
  managedSkillStatusCopy,
  managedSkillSummaryCopy
} from './managed-skill-status-copy'

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
    !installation.providers.includes('agent-skills') ? 'Agent Skills' : null,
    !installation.providers.includes('codex') ? 'Codex' : null,
    !installation.providers.includes('claude') ? 'Claude' : null
  ].filter((provider): provider is string => provider !== null)
  return missing.length > 0
    ? translate(
        'auto.components.settings.ManagedOrcaSkills.notVisible',
        'Not available to {{value0}}.',
        { value0: missing.join(', ') }
      )
    : null
}

export function ManagedOrcaSkillsSection(): React.JSX.Element {
  const state = useManagedAgentSkills()
  const [preview, setPreview] = useState<SkillReplacementPreview | null>(null)
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null)
  const previewLoadingIdRef = useRef<string | null>(null)

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
    if (previewLoadingIdRef.current !== null) {
      return
    }
    previewLoadingIdRef.current = installationId
    setPreviewLoadingId(installationId)
    try {
      setPreview(await state.previewReplacement(installationId))
    } catch (error) {
      reportFailure(error)
    } finally {
      previewLoadingIdRef.current = null
      setPreviewLoadingId(null)
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
        title={translate('auto.components.settings.ManagedOrcaSkills.title', 'Orca skill updates')}
        description={translate(
          'auto.components.settings.ManagedOrcaSkills.description',
          'Track new versions of official Orca skills and choose when to update them.'
        )}
        action={
          <Button
            variant="ghost"
            size="xs"
            disabled={state.loading}
            onClick={() => void state.refresh()}
          >
            <RefreshCw className={state.loading ? 'animate-spin' : undefined} />
            {translate('auto.components.settings.ManagedOrcaSkills.refresh', 'Check now')}
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
                    <span className="text-sm font-medium text-foreground">
                      {managedSkillDisplayName(installation.name)}
                    </span>
                    <SettingsBadge tone={statusTone(installation.status)}>
                      {managedSkillStatusCopy(installation.status)}
                    </SettingsBadge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {managedSkillSummaryCopy(installation)}
                  </p>
                  {visibility ? (
                    <p className="text-[11px] text-muted-foreground">{visibility}</p>
                  ) : null}
                  {!installation.actionsSupported ? (
                    <p className="text-[11px] text-muted-foreground">
                      {translate(
                        'auto.components.settings.ManagedOrcaSkills.hostPending',
                        'View only on this host; updating is not available yet.'
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
                          'Orca is now tracking this skill for updates.'
                        )
                      )
                    }
                  >
                    {busy ? <Loader2 className="animate-spin" /> : null}
                    {installation.status === 'known-update-available'
                      ? translate(
                          'auto.components.settings.ManagedOrcaSkills.manageUpdateAction',
                          'Track & update'
                        )
                      : translate(
                          'auto.components.settings.ManagedOrcaSkills.manageAction',
                          'Track updates'
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
                    disabled={busy || previewLoadingId !== null}
                    onClick={() => void reviewReplacement(installation.id)}
                  >
                    {previewLoadingId === installation.id ? (
                      <Loader2 className="animate-spin" />
                    ) : null}
                    {translate(
                      'auto.components.settings.ManagedOrcaSkills.reviewAction',
                      'Review changes'
                    )}
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
            'No installed Orca skills found.'
          )}
        </p>
      )}
      {preview ? (
        <ManagedSkillReplacementDialog
          preview={preview}
          busy={state.busyInstallationId === preview.installationId}
          onClose={() => setPreview(null)}
          onConfirm={() =>
            void run(
              () => state.replace(preview.installationId),
              translate(
                'auto.components.settings.ManagedOrcaSkills.replacedToast',
                'Replaced with Orca’s official version.'
              )
            ).then((succeeded) => succeeded && setPreview(null))
          }
        />
      ) : null}
    </section>
  )
}

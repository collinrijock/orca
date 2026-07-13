import { AlertTriangle, Check, Loader2 } from 'lucide-react'
import type { PluginMarketplaceHostInstallPreview } from '../../../../preload/api-types'
import { translate } from '@/i18n/i18n'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'
import { pluginCapabilityDescription } from './plugin-capability-presentation'

export type PluginMarketplacePreviewMode = 'install' | 'update'

type PluginMarketplacePreviewDialogProps = {
  preview: PluginMarketplaceHostInstallPreview | null
  mode: PluginMarketplacePreviewMode
  busy: boolean
  currentVersion: boolean
  error: string | null
  onClose: () => void
  onConfirm: () => void
}

function contributionSummary(
  preview: PluginMarketplaceHostInstallPreview
): { key: string; label: string }[] {
  const { contributes } = preview.manifest
  const entries: { key: string; count: number; label: string }[] = [
    {
      key: 'themes',
      count: contributes.themes.length,
      label: translate(
        'auto.components.settings.PluginMarketplacePreviewDialog.themes',
        '{{value0}} app themes',
        { value0: contributes.themes.length }
      )
    },
    {
      key: 'iconThemes',
      count: contributes.iconThemes.length,
      label: translate(
        'auto.components.settings.PluginMarketplacePreviewDialog.iconThemes',
        '{{value0}} icon themes',
        { value0: contributes.iconThemes.length }
      )
    },
    {
      key: 'terminalThemes',
      count: contributes.terminalThemes.length,
      label: translate(
        'auto.components.settings.PluginMarketplacePreviewDialog.terminalThemes',
        '{{value0}} terminal themes',
        { value0: contributes.terminalThemes.length }
      )
    },
    {
      key: 'languagePacks',
      count: contributes.languagePacks.length,
      label: translate(
        'auto.components.settings.PluginMarketplacePreviewDialog.languagePacks',
        '{{value0}} language packs',
        { value0: contributes.languagePacks.length }
      )
    },
    {
      key: 'skills',
      count: contributes.skills.length,
      label: translate(
        'auto.components.settings.PluginMarketplacePreviewDialog.skills',
        '{{value0}} skill packs',
        { value0: contributes.skills.length }
      )
    },
    {
      key: 'commands',
      count: contributes.commands.length,
      label: translate(
        'auto.components.settings.PluginMarketplacePreviewDialog.commands',
        '{{value0}} commands',
        { value0: contributes.commands.length }
      )
    },
    {
      key: 'keybindings',
      count: contributes.keybindings.length,
      label: translate(
        'auto.components.settings.PluginMarketplacePreviewDialog.keybindings',
        '{{value0}} keyboard shortcuts',
        { value0: contributes.keybindings.length }
      )
    },
    {
      key: 'vmRecipes',
      count: contributes.vmRecipes.length,
      label: translate(
        'auto.components.settings.PluginMarketplacePreviewDialog.vmRecipes',
        '{{value0}} VM recipes',
        { value0: contributes.vmRecipes.length }
      )
    },
    {
      key: 'panels',
      count: contributes.panels.length,
      label: translate(
        'auto.components.settings.PluginMarketplacePreviewDialog.panels',
        '{{value0}} panels',
        { value0: contributes.panels.length }
      )
    },
    {
      key: 'events',
      count: contributes.events.length,
      label: translate(
        'auto.components.settings.PluginMarketplacePreviewDialog.events',
        '{{value0}} event subscriptions',
        { value0: contributes.events.length }
      )
    }
  ]
  const summary: { key: string; label: string }[] = entries
    .filter((entry) => entry.count > 0)
    .map(({ key, label }) => ({ key, label }))
  if (preview.manifest.main) {
    summary.push({
      key: 'worker',
      label: translate(
        'auto.components.settings.PluginMarketplacePreviewDialog.worker',
        'Background worker'
      )
    })
  }
  return summary
}

export function PluginMarketplacePreviewDialog({
  preview,
  mode,
  busy,
  currentVersion,
  error,
  onClose,
  onConfirm
}: PluginMarketplacePreviewDialogProps): React.JSX.Element {
  const contributions = preview ? contributionSummary(preview) : []
  const blocked = preview?.blockedByKillList
  return (
    <Dialog open={Boolean(preview)} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="plugin-security-chrome max-h-[calc(100vh-3rem)] overflow-y-auto scrollbar-sleek sm:max-w-xl">
        {preview ? (
          <>
            <DialogHeader>
              <div className="flex flex-wrap items-center gap-2 pr-6">
                <DialogTitle>{preview.manifest.name}</DialogTitle>
                {preview.official ? (
                  <Badge variant="outline">
                    {translate(
                      'auto.components.settings.PluginMarketplacePreviewDialog.official',
                      'Official'
                    )}
                  </Badge>
                ) : null}
                {preview.bundled ? (
                  <Badge variant="secondary">
                    {translate(
                      'auto.components.settings.PluginMarketplacePreviewDialog.bundled',
                      'Bundled'
                    )}
                  </Badge>
                ) : null}
              </div>
              <DialogDescription>
                {translate(
                  'auto.components.settings.PluginMarketplacePreviewDialog.subtitle',
                  '{{value0}} v{{value1}} · {{value2}}',
                  {
                    value0: preview.pluginKey,
                    value1: preview.manifest.version,
                    value2: preview.marketplaceName
                  }
                )}
              </DialogDescription>
            </DialogHeader>
            {preview.manifest.description ? (
              <p className="text-sm leading-6">{preview.manifest.description}</p>
            ) : null}
            <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
              <dt className="text-xs text-muted-foreground">
                {translate(
                  'auto.components.settings.PluginMarketplacePreviewDialog.source',
                  'Plugin source'
                )}
              </dt>
              <dd className="truncate font-mono text-xs" title={preview.source.url}>
                {preview.source.url}#{preview.source.ref}
              </dd>
              <dt className="text-xs text-muted-foreground">
                {translate(
                  'auto.components.settings.PluginMarketplacePreviewDialog.commit',
                  'Pinned commit'
                )}
              </dt>
              <dd className="break-all font-mono text-xs">{preview.resolvedCommit}</dd>
              <dt className="text-xs text-muted-foreground">
                {translate(
                  'auto.components.settings.PluginMarketplacePreviewDialog.marketplaceCommit',
                  'Index commit'
                )}
              </dt>
              <dd className="break-all font-mono text-xs">{preview.marketplaceCommit}</dd>
            </dl>
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                {translate(
                  'auto.components.settings.PluginMarketplacePreviewDialog.includes',
                  'Includes'
                )}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {contributions.length > 0 ? (
                  contributions.map((entry) => (
                    <Badge key={entry.key} variant="secondary">
                      {entry.label}
                    </Badge>
                  ))
                ) : (
                  <span className="text-sm text-muted-foreground">
                    {translate(
                      'auto.components.settings.PluginMarketplacePreviewDialog.noContributions',
                      'Manifest metadata only'
                    )}
                  </span>
                )}
              </div>
            </div>
            {preview.manifest.capabilities.length > 0 ? (
              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                  {translate(
                    'auto.components.settings.PluginMarketplacePreviewDialog.capabilities',
                    'Requested access'
                  )}
                </p>
                {preview.manifest.capabilities.map((capability) => (
                  <div key={capability.kind} className="flex items-start gap-2 text-sm leading-6">
                    <Check className="mt-1 size-3.5 shrink-0 text-muted-foreground" />
                    <span>
                      {pluginCapabilityDescription(capability.kind, capability.kind)}{' '}
                      <span className="font-mono text-[11px] text-muted-foreground">
                        ({capability.kind})
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
            {preview.manifest.main ? (
              <div className="flex items-start gap-2 rounded-md border border-border bg-muted/50 px-3.5 py-3 text-sm leading-6">
                <AlertTriangle className="mt-1 size-4 shrink-0" />
                <span>
                  {translate(
                    'auto.components.settings.PluginMarketplacePreviewDialog.workerWarning',
                    "Capabilities limit how this plugin uses Orca's API. Its worker still runs as a normal process on this computer with full access to your files, network, and other processes."
                  )}
                </span>
              </div>
            ) : null}
            {blocked ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3.5 py-3 text-sm text-destructive">
                {translate(
                  'auto.components.settings.PluginMarketplacePreviewDialog.blocked',
                  "Orca's safety list blocks this plugin: {{value0}}",
                  { value0: blocked.reason }
                )}
              </p>
            ) : null}
            {currentVersion ? (
              <p className="text-sm text-muted-foreground">
                {translate(
                  'auto.components.settings.PluginMarketplacePreviewDialog.current',
                  'This exact plugin content is already installed.'
                )}
              </p>
            ) : null}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <DialogFooter>
              <Button variant="ghost" disabled={busy} onClick={onClose}>
                {translate(
                  'auto.components.settings.PluginMarketplacePreviewDialog.cancel',
                  'Cancel'
                )}
              </Button>
              <Button disabled={busy || Boolean(blocked) || currentVersion} onClick={onConfirm}>
                {busy ? <Loader2 className="animate-spin" /> : null}
                {mode === 'update'
                  ? translate(
                      'auto.components.settings.PluginMarketplacePreviewDialog.update',
                      'Update plugin'
                    )
                  : translate(
                      'auto.components.settings.PluginMarketplacePreviewDialog.install',
                      'Install plugin'
                    )}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

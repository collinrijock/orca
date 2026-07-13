import { AlertTriangle, Loader2, Package } from 'lucide-react'
import type {
  PluginHostListEntry,
  PluginMarketplaceHostListing
} from '../../../../preload/api-types'
import { translate } from '@/i18n/i18n'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'

type PluginMarketplaceListingRowProps = {
  listing: PluginMarketplaceHostListing
  installed: PluginHostListEntry | null
  busy: boolean
  onPreview: (listing: PluginMarketplaceHostListing, update: boolean) => void
}

export function PluginMarketplaceListingRow({
  listing,
  installed,
  busy,
  onPreview
}: PluginMarketplaceListingRowProps): React.JSX.Element {
  const blocked = listing.blockedByKillList
  const canCheckUpdate = installed?.source?.kind === 'marketplace'
  return (
    <div
      className="flex flex-wrap items-start gap-3 px-4 py-3 [&+&]:border-t [&+&]:border-border/60"
      data-marketplace-plugin-key={listing.pluginKey}
    >
      <div className="mt-0.5 rounded-md bg-muted p-2 text-muted-foreground">
        <Package className="size-4" />
      </div>
      <div className="min-w-48 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-sm font-medium">{listing.pluginKey}</span>
          {listing.official ? (
            <Badge variant="outline" className="plugin-security-chrome">
              {translate(
                'auto.components.settings.PluginMarketplaceListingRow.official',
                'Official'
              )}
            </Badge>
          ) : null}
          {listing.bundled ? (
            <Badge variant="secondary">
              {translate('auto.components.settings.PluginMarketplaceListingRow.bundled', 'Bundled')}
            </Badge>
          ) : null}
          {installed ? (
            <Badge variant="secondary">
              {translate(
                'auto.components.settings.PluginMarketplaceListingRow.installed',
                'Installed'
              )}
            </Badge>
          ) : null}
        </div>
        {listing.description ? (
          <p className="mt-1 text-sm leading-5 text-muted-foreground">{listing.description}</p>
        ) : null}
        <p className="mt-1 text-xs text-muted-foreground">
          {translate(
            'auto.components.settings.PluginMarketplaceListingRow.marketplace',
            '{{value0}} · {{value1}}',
            { value0: listing.marketplaceName, value1: listing.marketplaceOwner }
          )}
        </p>
        {listing.categories.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {listing.categories.map((category) => (
              <Badge key={category} variant="outline" className="text-[10px] text-muted-foreground">
                {category}
              </Badge>
            ))}
          </div>
        ) : null}
        {blocked ? (
          <p className="plugin-security-chrome mt-2 flex items-start gap-1.5 text-xs leading-5 text-destructive">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {translate(
                'auto.components.settings.PluginMarketplaceListingRow.blocked',
                "Blocked by Orca's safety list: {{value0}}",
                { value0: blocked.reason }
              )}
            </span>
          </p>
        ) : null}
      </div>
      <Button
        variant="outline"
        size="xs"
        className="w-32"
        disabled={busy || Boolean(blocked) || Boolean(installed && !canCheckUpdate)}
        onClick={() => onPreview(listing, Boolean(canCheckUpdate))}
      >
        {busy ? <Loader2 className="animate-spin" /> : null}
        {blocked
          ? translate(
              'auto.components.settings.PluginMarketplaceListingRow.blockedAction',
              'Blocked'
            )
          : canCheckUpdate
            ? translate(
                'auto.components.settings.PluginMarketplaceListingRow.checkUpdate',
                'Check for update'
              )
            : installed
              ? translate(
                  'auto.components.settings.PluginMarketplaceListingRow.installedAction',
                  'Installed'
                )
              : translate('auto.components.settings.PluginMarketplaceListingRow.review', 'Review')}
      </Button>
    </div>
  )
}

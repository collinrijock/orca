import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, RefreshCw, Search, Settings2 } from 'lucide-react'
import type {
  PluginHostListEntry,
  PluginMarketplaceHostInstallPreview,
  PluginMarketplaceHostListing,
  PluginMarketplaceHostSourceState
} from '../../../../preload/api-types'
import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { PluginMarketplaceListingRow } from './PluginMarketplaceListingRow'
import {
  PluginMarketplacePreviewDialog,
  type PluginMarketplacePreviewMode
} from './PluginMarketplacePreviewDialog'
import { PluginMarketplaceSourceDialog } from './PluginMarketplaceSourceDialog'

type PluginMarketplaceBrowserProps = {
  installedPlugins: readonly PluginHostListEntry[]
  onInstalled: (pluginKey: string) => Promise<void>
}

function marketplaceError(cause: unknown, fallback: string): string {
  console.warn('[plugins] marketplace action failed:', cause)
  return fallback
}

export function PluginMarketplaceBrowser({
  installedPlugins,
  onInstalled
}: PluginMarketplaceBrowserProps): React.JSX.Element {
  const [sources, setSources] = useState<PluginMarketplaceHostSourceState[]>([])
  const [listings, setListings] = useState<PluginMarketplaceHostListing[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshBusy, setRefreshBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const [preview, setPreview] = useState<PluginMarketplaceHostInstallPreview | null>(null)
  const [previewMode, setPreviewMode] = useState<PluginMarketplacePreviewMode>('install')
  const [previewBusyKey, setPreviewBusyKey] = useState<string | null>(null)
  const [installBusy, setInstallBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const mountedRef = useRef(false)
  const requestRef = useRef(0)
  const previewRequestRef = useRef(0)

  const loadMarketplaceData = useCallback(async (): Promise<void> => {
    const requestId = ++requestRef.current
    try {
      const [nextSources, nextListings] = await Promise.all([
        window.api.plugins.listMarketplaces(),
        window.api.plugins.listMarketplacePlugins()
      ])
      if (mountedRef.current && requestId === requestRef.current) {
        setSources(nextSources)
        setListings(nextListings)
        setError(null)
      }
    } catch (cause) {
      if (mountedRef.current && requestId === requestRef.current) {
        setError(
          marketplaceError(
            cause,
            translate(
              'auto.components.settings.PluginMarketplaceBrowser.loadFailed',
              'Could not load marketplace plugins.'
            )
          )
        )
      }
    } finally {
      if (mountedRef.current && requestId === requestRef.current) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    void loadMarketplaceData()
    return () => {
      mountedRef.current = false
      requestRef.current += 1
      previewRequestRef.current += 1
    }
  }, [loadMarketplaceData])

  const installedByKey = useMemo(
    () => new Map(installedPlugins.map((plugin) => [plugin.pluginKey, plugin])),
    [installedPlugins]
  )
  const visibleListings = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    if (!query) {
      return listings
    }
    return listings.filter((listing) =>
      [
        listing.pluginKey,
        listing.description ?? '',
        listing.marketplaceName,
        listing.marketplaceOwner,
        ...listing.categories
      ].some((value) => value.toLocaleLowerCase().includes(query))
    )
  }, [listings, search])

  const refresh = async (): Promise<void> => {
    setRefreshBusy(true)
    setError(null)
    try {
      await window.api.plugins.refreshMarketplaces({})
      await loadMarketplaceData()
    } catch (cause) {
      if (mountedRef.current) {
        setError(
          marketplaceError(
            cause,
            translate(
              'auto.components.settings.PluginMarketplaceBrowser.refreshFailed',
              'Could not refresh marketplaces. Cached listings remain available.'
            )
          )
        )
      }
    } finally {
      if (mountedRef.current) {
        setRefreshBusy(false)
      }
    }
  }

  const openPreview = async (
    listing: PluginMarketplaceHostListing,
    update: boolean
  ): Promise<void> => {
    const requestId = ++previewRequestRef.current
    setPreviewBusyKey(listing.pluginKey)
    setActionError(null)
    setError(null)
    try {
      const nextPreview = update
        ? await window.api.plugins.previewMarketplaceUpdate({ pluginKey: listing.pluginKey })
        : await window.api.plugins.previewMarketplacePlugin({
            marketplaceSourceId: listing.marketplaceSourceId,
            pluginKey: listing.pluginKey
          })
      if (mountedRef.current && requestId === previewRequestRef.current) {
        setPreviewMode(update ? 'update' : 'install')
        setPreview(nextPreview)
      }
    } catch (cause) {
      if (mountedRef.current && requestId === previewRequestRef.current) {
        setError(
          marketplaceError(
            cause,
            translate(
              'auto.components.settings.PluginMarketplaceBrowser.previewFailed',
              'Could not prepare this plugin for review. Refresh the marketplace and try again.'
            )
          )
        )
      }
    } finally {
      if (mountedRef.current && requestId === previewRequestRef.current) {
        setPreviewBusyKey(null)
      }
    }
  }

  const installPreview = async (): Promise<void> => {
    if (!preview || installBusy) {
      return
    }
    setInstallBusy(true)
    setActionError(null)
    try {
      const result = await window.api.plugins.installMarketplacePlugin({
        marketplaceSourceId: preview.marketplaceSourceId,
        marketplaceCommit: preview.marketplaceCommit,
        pluginKey: preview.pluginKey,
        resolvedCommit: preview.resolvedCommit
      })
      if (!result.ok) {
        throw new Error(result.error)
      }
      setPreview(null)
      await onInstalled(result.pluginKey)
    } catch (cause) {
      if (mountedRef.current) {
        setActionError(
          marketplaceError(
            cause,
            translate(
              'auto.components.settings.PluginMarketplaceBrowser.installFailed',
              'Could not install this plugin. The reviewed source may have changed.'
            )
          )
        )
      }
    } finally {
      if (mountedRef.current) {
        setInstallBusy(false)
      }
    }
  }

  const currentVersion = Boolean(
    preview && installedByKey.get(preview.pluginKey)?.source?.contentHash === preview.contentHash
  )

  return (
    <section aria-labelledby="plugin-marketplace-heading">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span
          id="plugin-marketplace-heading"
          className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground"
        >
          {translate('auto.components.settings.PluginMarketplaceBrowser.heading', 'Marketplace')}
        </span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="xs" onClick={() => setSourcesOpen(true)}>
            <Settings2 />
            {translate(
              'auto.components.settings.PluginMarketplaceBrowser.manageSources',
              'Manage sources'
            )}
          </Button>
          <Button variant="ghost" size="xs" disabled={refreshBusy} onClick={() => void refresh()}>
            <RefreshCw className={refreshBusy ? 'animate-spin' : undefined} />
            {refreshBusy
              ? translate(
                  'auto.components.settings.PluginMarketplaceBrowser.refreshing',
                  'Refreshing…'
                )
              : translate('auto.components.settings.PluginMarketplaceBrowser.refresh', 'Refresh')}
          </Button>
        </div>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 px-4 py-5 text-[13px] text-muted-foreground">
          <Loader2 className="animate-spin" />
          {translate(
            'auto.components.settings.PluginMarketplaceBrowser.loading',
            'Loading marketplace plugins…'
          )}
        </div>
      ) : (
        <>
          {sources.length > 0 ? (
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                className="pl-9"
                aria-label={translate(
                  'auto.components.settings.PluginMarketplaceBrowser.searchLabel',
                  'Search marketplace plugins'
                )}
                placeholder={translate(
                  'auto.components.settings.PluginMarketplaceBrowser.searchPlaceholder',
                  'Search plugins, categories, or publishers'
                )}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          ) : null}
          {error ? (
            <div className="mb-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              <p>{error}</p>
              <Button variant="outline" size="xs" className="mt-2" onClick={loadMarketplaceData}>
                {translate(
                  'auto.components.settings.PluginMarketplaceBrowser.tryAgain',
                  'Try again'
                )}
              </Button>
            </div>
          ) : null}
          {sources.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border px-5 py-6 text-center text-[13px] leading-6 text-muted-foreground">
              <p>
                {translate(
                  'auto.components.settings.PluginMarketplaceBrowser.noSources',
                  'Add an official, community, or private Git marketplace to browse plugins.'
                )}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => setSourcesOpen(true)}
              >
                {translate(
                  'auto.components.settings.PluginMarketplaceBrowser.addSource',
                  'Add marketplace'
                )}
              </Button>
            </div>
          ) : visibleListings.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border px-5 py-6 text-center text-[13px] leading-6 text-muted-foreground">
              {search
                ? translate(
                    'auto.components.settings.PluginMarketplaceBrowser.noResults',
                    'No marketplace plugins match this search.'
                  )
                : translate(
                    'auto.components.settings.PluginMarketplaceBrowser.empty',
                    'The configured marketplaces do not list any plugins.'
                  )}
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border/80">
              {visibleListings.map((listing) => (
                <PluginMarketplaceListingRow
                  key={`${listing.marketplaceSourceId}:${listing.pluginKey}`}
                  listing={listing}
                  installed={installedByKey.get(listing.pluginKey) ?? null}
                  busy={previewBusyKey === listing.pluginKey}
                  onPreview={(entry, update) => void openPreview(entry, update)}
                />
              ))}
            </div>
          )}
        </>
      )}
      <PluginMarketplaceSourceDialog
        open={sourcesOpen}
        sources={sources}
        onOpenChange={setSourcesOpen}
        onChanged={loadMarketplaceData}
      />
      <PluginMarketplacePreviewDialog
        key={preview ? `${preview.pluginKey}:${preview.contentHash}` : 'closed'}
        preview={preview}
        mode={previewMode}
        busy={installBusy}
        currentVersion={currentVersion}
        error={actionError}
        onClose={() => setPreview(null)}
        onConfirm={() => void installPreview()}
      />
    </section>
  )
}

import { useEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import type {
  PluginHostInstallSource,
  PluginHostListEntry,
  PluginHostLogLine
} from '../../../../preload/api-types'
import type { GlobalSettings } from '../../../../shared/types'
import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'
import { PluginConsentDialog } from './PluginConsentDialog'
import { PluginInstallDialog } from './PluginInstallDialog'
import { PluginRemoveDialog } from './PluginRemoveDialog'
import { PluginSkillMappingDialog } from './PluginSkillMappingDialog'
import { PluginSettingsOverview } from './PluginSettingsOverview'
import type { PluginLogsState } from './PluginSettingsRow'
import { getPluginsSectionPresentation } from './plugins-search'
import { SettingsSection } from './SettingsSection'

type PluginsSettingsSectionProps = {
  mounted: boolean
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => Promise<void>
}

function errorMessage(cause: unknown, fallback: string): string {
  console.warn('[plugins] settings action failed:', cause)
  return fallback
}

export function PluginsSettingsSection({
  mounted,
  settings,
  updateSettings
}: PluginsSettingsSectionProps): React.JSX.Element {
  const [plugins, setPlugins] = useState<PluginHostListEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [installOpen, setInstallOpen] = useState(false)
  const [consentPluginId, setConsentPluginId] = useState<string | null>(null)
  const [removePluginId, setRemovePluginId] = useState<string | null>(null)
  const [skillPluginId, setSkillPluginId] = useState<string | null>(null)
  const [busyPluginKeys, setBusyPluginKeys] = useState<Set<string>>(() => new Set())
  const [featureBusy, setFeatureBusy] = useState(false)
  const [refreshBusy, setRefreshBusy] = useState(false)
  const [devPathsBusy, setDevPathsBusy] = useState(false)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [openLogs, setOpenLogs] = useState<Set<string>>(() => new Set())
  const [logsByPlugin, setLogsByPlugin] = useState<Record<string, PluginLogsState>>({})
  const mountedRef = useRef(false)
  const listRequestRef = useRef(0)
  const nextLogsRequestRef = useRef(0)
  const logsRequestRef = useRef<Record<string, number>>({})

  const applyPluginList = (nextPlugins: PluginHostListEntry[]): void => {
    const installedPluginKeys = new Set(nextPlugins.map((plugin) => plugin.pluginKey))
    setPlugins(nextPlugins)
    setError(null)
    // Why: accepted discovery results own installed-plugin identity and invalidate stale UI state.
    setConsentPluginId((current) => (current && installedPluginKeys.has(current) ? current : null))
    setRemovePluginId((current) => (current && installedPluginKeys.has(current) ? current : null))
    setSkillPluginId((current) => (current && installedPluginKeys.has(current) ? current : null))
    setBusyPluginKeys(
      (current) => new Set([...current].filter((pluginKey) => installedPluginKeys.has(pluginKey)))
    )
    setOpenLogs(
      (current) => new Set([...current].filter((pluginKey) => installedPluginKeys.has(pluginKey)))
    )
    setLogsByPlugin((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([pluginKey]) => installedPluginKeys.has(pluginKey))
      )
    )
    for (const pluginKey of Object.keys(logsRequestRef.current)) {
      if (!installedPluginKeys.has(pluginKey)) {
        delete logsRequestRef.current[pluginKey]
      }
    }
  }

  const setPluginListError = (cause: unknown): void => {
    setError(
      errorMessage(
        cause,
        translate(
          'auto.components.settings.PluginsSettingsSection.loadFailed',
          'Could not load plugins.'
        )
      )
    )
  }

  const loadPluginList = async (
    request: Promise<PluginHostListEntry[]>
  ): Promise<PluginHostListEntry[] | null> => {
    const requestId = ++listRequestRef.current
    try {
      const nextPlugins = await request
      if (!mountedRef.current || requestId !== listRequestRef.current) {
        return null
      }
      applyPluginList(nextPlugins)
      return nextPlugins
    } catch (cause) {
      if (mountedRef.current && requestId === listRequestRef.current) {
        setPluginListError(cause)
      }
      return null
    }
  }

  const applyCompletedMutation = (nextPlugins: PluginHostListEntry[]): void => {
    if (!mountedRef.current) {
      return
    }
    // Why: a mutation result is authoritative at completion time, even when an earlier action
    // finishes after a later-started action or a passive refresh is still in flight.
    listRequestRef.current += 1
    applyPluginList(nextPlugins)
  }

  useEffect(() => {
    mountedRef.current = mounted
    if (!mounted) {
      // Why: hidden lazy panes must not resurrect dialogs or unresolved async state when reopened.
      setPlugins([])
      setLoading(true)
      setError(null)
      setInstallOpen(false)
      setConsentPluginId(null)
      setRemovePluginId(null)
      setSkillPluginId(null)
      setBusyPluginKeys(new Set())
      setFeatureBusy(false)
      setRefreshBusy(false)
      setDevPathsBusy(false)
      setSettingsError(null)
      setOpenLogs(new Set())
      setLogsByPlugin({})
      logsRequestRef.current = {}
    }
    return () => {
      mountedRef.current = false
      listRequestRef.current += 1
    }
  }, [mounted])

  useEffect(() => {
    if (!mounted || !settings.pluginSystemEnabled) {
      return
    }
    setLoading(true)
    const load = async (): Promise<void> => {
      await loadPluginList(window.api.plugins.list())
      if (mountedRef.current) {
        setLoading(false)
      }
    }
    void load()
    const unsubscribe = window.api.plugins.onChanged(() => {
      void loadPluginList(window.api.plugins.list())
    })
    return () => {
      listRequestRef.current += 1
      unsubscribe()
    }
  }, [mounted, settings.pluginSystemEnabled])

  const sectionPresentation = getPluginsSectionPresentation()

  if (!mounted) {
    return <SettingsSection id="plugins" {...sectionPresentation} />
  }

  const selectedConsentPlugin =
    plugins.find((plugin) => plugin.pluginKey === consentPluginId) ?? null
  const consentPlugin = selectedConsentPlugin?.consentFingerprint ? selectedConsentPlugin : null
  const removePlugin = plugins.find((plugin) => plugin.pluginKey === removePluginId) ?? null
  const skillPlugin = plugins.find((plugin) => plugin.pluginKey === skillPluginId) ?? null

  const toggleFeature = async (): Promise<void> => {
    setFeatureBusy(true)
    setSettingsError(null)
    setError(null)
    try {
      await updateSettings({ pluginSystemEnabled: !settings.pluginSystemEnabled })
      await loadPluginList(window.api.plugins.refresh())
    } catch {
      if (mountedRef.current) {
        setSettingsError(
          translate(
            'auto.components.settings.PluginsSettingsSection.settingsUpdateFailed',
            'Could not save plugin settings.'
          )
        )
      }
    } finally {
      if (mountedRef.current) {
        setFeatureBusy(false)
      }
    }
  }

  const install = async (source: PluginHostInstallSource): Promise<void> => {
    const result = await window.api.plugins.install(source)
    if (!result.ok) {
      throw new Error(result.error)
    }
    // Why: installation is not consent; select by id and wait for the authoritative list.
    setInstallOpen(false)
    setConsentPluginId(result.pluginKey)
    await loadPluginList(window.api.plugins.refresh())
  }

  const decideConsent = async (
    pluginKey: string,
    reviewedFingerprint: string,
    decision: 'approve' | 'keep-disabled'
  ): Promise<void> => {
    setBusyPluginKeys((current) => new Set(current).add(pluginKey))
    try {
      const nextPlugins = await window.api.plugins.consent({
        pluginKey,
        reviewedFingerprint,
        decision
      })
      applyCompletedMutation(nextPlugins)
      if (mountedRef.current) {
        setConsentPluginId(null)
      }
    } finally {
      if (mountedRef.current) {
        setBusyPluginKeys((current) => {
          const next = new Set(current)
          next.delete(pluginKey)
          return next
        })
      }
    }
  }

  const toggleEnabled = async (plugin: PluginHostListEntry): Promise<void> => {
    const enabled =
      plugin.status === 'running' ||
      plugin.status === 'restarting' ||
      plugin.status === 'idle' ||
      plugin.status === 'errored'
    setBusyPluginKeys((current) => new Set(current).add(plugin.pluginKey))
    try {
      const nextPlugins = await window.api.plugins.setEnabled({
        pluginKey: plugin.pluginKey,
        enabled: !enabled
      })
      applyCompletedMutation(nextPlugins)
    } catch (cause) {
      if (mountedRef.current) {
        setPluginListError(cause)
      }
    } finally {
      if (mountedRef.current) {
        setBusyPluginKeys((current) => {
          const next = new Set(current)
          next.delete(plugin.pluginKey)
          return next
        })
      }
    }
  }

  const remove = async (pluginKey: string): Promise<void> => {
    setBusyPluginKeys((current) => new Set(current).add(pluginKey))
    try {
      const nextPlugins = await window.api.plugins.remove({ pluginKey })
      applyCompletedMutation(nextPlugins)
      if (mountedRef.current) {
        setRemovePluginId(null)
      }
    } catch (cause) {
      if (mountedRef.current) {
        setPluginListError(cause)
      }
    } finally {
      if (mountedRef.current) {
        setBusyPluginKeys((current) => {
          const next = new Set(current)
          next.delete(pluginKey)
          return next
        })
      }
    }
  }

  const refresh = async (): Promise<void> => {
    setRefreshBusy(true)
    await loadPluginList(window.api.plugins.refresh())
    if (mountedRef.current) {
      setRefreshBusy(false)
    }
  }

  const toggleLogs = (pluginKey: string): void => {
    if (openLogs.has(pluginKey)) {
      setOpenLogs((current) => {
        const next = new Set(current)
        next.delete(pluginKey)
        return next
      })
      return
    }
    setOpenLogs((current) => new Set(current).add(pluginKey))
    if (logsByPlugin[pluginKey]?.lines) {
      return
    }
    const requestId = ++nextLogsRequestRef.current
    logsRequestRef.current[pluginKey] = requestId
    setLogsByPlugin((current) => ({ ...current, [pluginKey]: { loading: true } }))
    void window.api.plugins
      .getLogs({ pluginKey })
      .then((lines: PluginHostLogLine[]) => {
        if (mountedRef.current && logsRequestRef.current[pluginKey] === requestId) {
          setLogsByPlugin((current) => ({
            ...current,
            [pluginKey]: { loading: false, lines }
          }))
        }
      })
      .catch((cause: unknown) => {
        if (mountedRef.current && logsRequestRef.current[pluginKey] === requestId) {
          setLogsByPlugin((current) => ({
            ...current,
            [pluginKey]: {
              loading: false,
              error: errorMessage(
                cause,
                translate(
                  'auto.components.settings.PluginsSettingsSection.logsFailed',
                  'Could not load plugin logs.'
                )
              )
            }
          }))
        }
      })
  }

  const updateDevPaths = async (paths: string[]): Promise<void> => {
    setDevPathsBusy(true)
    setSettingsError(null)
    try {
      await updateSettings({ devPluginPaths: paths })
      await loadPluginList(window.api.plugins.refresh())
    } catch {
      const message = translate(
        'auto.components.settings.PluginsSettingsSection.settingsUpdateFailed',
        'Could not save plugin settings.'
      )
      if (mountedRef.current) {
        setSettingsError(message)
      }
      throw new Error(message)
    } finally {
      if (mountedRef.current) {
        setDevPathsBusy(false)
      }
    }
  }

  const featureEnabled = settings.pluginSystemEnabled
  return (
    <SettingsSection
      id="plugins"
      {...sectionPresentation}
      headerAction={
        <Button
          variant="outline"
          size="sm"
          disabled={!featureEnabled || featureBusy}
          onClick={() => setInstallOpen(true)}
        >
          <Plus />
          {translate('auto.components.settings.PluginsSettingsSection.install', 'Install plugin')}
        </Button>
      }
    >
      <PluginSettingsOverview
        featureEnabled={featureEnabled}
        featureBusy={featureBusy}
        settingsError={settingsError}
        loading={loading}
        refreshBusy={refreshBusy}
        error={error}
        plugins={plugins}
        busyPluginKeys={busyPluginKeys}
        openLogs={openLogs}
        logsByPlugin={logsByPlugin}
        devPaths={settings.devPluginPaths}
        devPathsBusy={devPathsBusy}
        onToggleFeature={() => void toggleFeature()}
        onRefresh={() => void refresh()}
        onReview={setConsentPluginId}
        onToggleEnabled={(entry) => void toggleEnabled(entry)}
        onToggleLogs={toggleLogs}
        onConfigureSkills={setSkillPluginId}
        onRemoveRequest={setRemovePluginId}
        onUpdateDevPaths={updateDevPaths}
      />
      <PluginInstallDialog open={installOpen} onOpenChange={setInstallOpen} onInstall={install} />
      <PluginConsentDialog
        key={consentPlugin?.pluginKey ?? 'closed'}
        plugin={consentPlugin}
        onDecision={decideConsent}
      />
      <PluginRemoveDialog
        plugin={removePlugin}
        busy={Boolean(removePlugin && busyPluginKeys.has(removePlugin.pluginKey))}
        onCancel={() => setRemovePluginId(null)}
        onConfirm={(pluginKey) => void remove(pluginKey)}
      />
      <PluginSkillMappingDialog plugin={skillPlugin} onClose={() => setSkillPluginId(null)} />
    </SettingsSection>
  )
}

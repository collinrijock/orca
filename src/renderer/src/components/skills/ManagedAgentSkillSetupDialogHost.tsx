import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Info, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import type { ManagedAgentSkillFallback } from '../../../../shared/skills'
import { buildAgentFeatureSkillUpdateCommand } from '@/lib/agent-feature-install-commands'
import {
  notifyInstalledAgentSkillsChanged,
  useInstalledAgentSkill
} from '@/hooks/useInstalledAgentSkills'
import {
  getManagedSkillContextCopy,
  getManagedSkillContextWorkspaceCopy,
  getManagedSkillFallbackDisplayMessage
} from './managed-agent-skill-dialog-copy'
import {
  advanceManagedAgentSkillFallbackQueue,
  enqueueManagedAgentSkillFallback,
  getInstalledStateSourceKinds,
  prepareManagedAgentSkillSetupTerminal,
  replaceActiveAfterManagedAgentSkillRecheck,
  type ManagedAgentSkillDialogState
} from './managed-agent-skill-dialog-state'
import { AgentSkillSetupPanel } from '@/components/settings/AgentSkillSetupPanel'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  AGENT_SKILL_CLI_PREREQUISITE_NOTICE,
  isOrcaCliAvailableOnPath
} from '@/lib/agent-skill-cli-prerequisite'
import { basename } from '@/lib/path'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'

export function ManagedAgentSkillSetupDialogHost(): React.JSX.Element | null {
  const [dialogState, setDialogState] = useState<ManagedAgentSkillDialogState>({
    active: null,
    queue: []
  })
  const queuedKeysRef = useRef(new Set<string>())
  const snoozedKeysRef = useRef(new Set<string>())
  const [rechecking, setRechecking] = useState(false)
  const setupPromptsEnabled = useAppStore(
    (state) => state.settings?.managedAgentSkillSetupPromptsEnabled !== false
  )
  const updateSettings = useAppStore((state) => state.updateSettings)
  const openSettingsPage = useAppStore((state) => state.openSettingsPage)
  const openSettingsTarget = useAppStore((state) => state.openSettingsTarget)
  const active = dialogState.active
  const installedState = useInstalledAgentSkill(active?.skillName ?? 'linear-tickets', {
    enabled: active !== null,
    discoveryTarget: active?.request.discoveryTarget,
    projectRootPath: active?.request.discoveryTarget?.projectRootPath,
    sourceKinds: active ? getInstalledStateSourceKinds(active.scope) : undefined
  })

  const enqueueFallback = useCallback(
    (event: ManagedAgentSkillFallback): void => {
      if (!setupPromptsEnabled || snoozedKeysRef.current.has(event.uiKey)) {
        return
      }
      if (queuedKeysRef.current.has(event.uiKey)) {
        return
      }
      queuedKeysRef.current.add(event.uiKey)
      setDialogState((current) => enqueueManagedAgentSkillFallback(current, event))
    },
    [setupPromptsEnabled]
  )

  useEffect(() => {
    if (setupPromptsEnabled) {
      return
    }
    queuedKeysRef.current.clear()
    snoozedKeysRef.current.clear()
    setDialogState({ active: null, queue: [] })
    setRechecking(false)
  }, [setupPromptsEnabled])

  const advanceQueue = useCallback((): void => {
    setDialogState((current) => {
      if (current.active) {
        queuedKeysRef.current.delete(current.active.uiKey)
      }
      return advanceManagedAgentSkillFallbackQueue(current)
    })
    setRechecking(false)
  }, [])

  useEffect(() => {
    const unsubscribeFallback = window.api.skills.onManagedFallback(enqueueFallback)
    const unsubscribeUpdated = window.api.skills.onManagedUpdated(() => {
      notifyInstalledAgentSkillsChanged()
    })
    return () => {
      unsubscribeFallback()
      unsubscribeUpdated()
    }
  }, [enqueueFallback])

  const contextActionLabel =
    active?.manualCommand?.kind === 'install'
      ? translate('auto.components.skills.ManagedAgentSkillSetupDialogHost.install', 'Install')
      : active?.manualCommand?.kind === 'update'
        ? translate('auto.components.skills.ManagedAgentSkillSetupDialogHost.update', 'Update')
        : translate('auto.components.skills.ManagedAgentSkillSetupDialogHost.review', 'Review')
  const contextCopy = active ? getManagedSkillContextCopy(active.context, contextActionLabel) : ''
  const installedCommand = useMemo(
    () => (active ? buildAgentFeatureSkillUpdateCommand(active.skillName) : ''),
    [active]
  )

  const recheck = useCallback(async (): Promise<void> => {
    if (!active || rechecking) {
      return
    }
    const recheckUiKey = active.uiKey
    setRechecking(true)
    try {
      const result = await window.api.skills.ensureManagedReady({ ...active.request, force: true })
      if (result.status === 'fallback') {
        setDialogState((current) => {
          if (current.active?.uiKey !== recheckUiKey) {
            return current
          }
          const previousKey = current.active.uiKey
          const next = replaceActiveAfterManagedAgentSkillRecheck(current, result)
          if (next.active?.uiKey !== previousKey) {
            queuedKeysRef.current.delete(previousKey)
            if (next.active) {
              queuedKeysRef.current.add(next.active.uiKey)
            }
          }
          return next
        })
        return
      }
      setDialogState((current) => {
        if (current.active?.uiKey !== recheckUiKey) {
          return current
        }
        queuedKeysRef.current.delete(recheckUiKey)
        return advanceManagedAgentSkillFallbackQueue(current)
      })
      notifyInstalledAgentSkillsChanged()
    } finally {
      setRechecking(false)
    }
  }, [active, rechecking])

  if (!active) {
    return null
  }

  const command = active.manualCommand?.command
  const loading = installedState.loading || rechecking
  const workspacePath = active.request.discoveryTarget?.projectRootPath?.trim() || null
  const workspaceName = workspacePath ? basename(workspacePath) || workspacePath : null
  const workspaceContextCopy =
    workspacePath && workspaceName
      ? getManagedSkillContextWorkspaceCopy(active.context, contextActionLabel)
      : null

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          snoozedKeysRef.current.add(active.uiKey)
          advanceQueue()
        }
      }}
    >
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[640px]">
        <div className="px-6 pt-6 pr-14">
          <DialogHeader>
            <DialogTitle>
              {translate(
                'auto.components.skills.ManagedAgentSkillSetupDialogHost.title',
                'Agent skill setup needed'
              )}
            </DialogTitle>
            <DialogDescription>
              {workspaceContextCopy && workspacePath && workspaceName ? (
                <>
                  {workspaceContextCopy.beforeWorkspace}
                  <span className="font-medium text-foreground" title={workspacePath}>
                    {workspaceName}
                  </span>
                  {workspaceContextCopy.afterWorkspace}
                </>
              ) : (
                contextCopy
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 flex items-start gap-2 text-[13px] leading-snug text-muted-foreground">
            <Info className="mt-px size-4 shrink-0" />
            <p>{getManagedSkillFallbackDisplayMessage(active.reason)}</p>
          </div>
        </div>
        {command ? (
          <AgentSkillSetupPanel
            className="px-6 pt-4 pb-3"
            variant="inline"
            hideHeader
            title={translate(
              'auto.components.skills.ManagedAgentSkillSetupDialogHost.panelTitle',
              'Set up managed agent skill'
            )}
            command={command}
            installedCommand={installedCommand}
            terminalTitle={translate(
              'auto.components.skills.ManagedAgentSkillSetupDialogHost.terminalTitle',
              'Set up agent skill'
            )}
            terminalAriaLabel={translate(
              'auto.components.skills.ManagedAgentSkillSetupDialogHost.terminalAria',
              'Agent skill setup terminal'
            )}
            terminalWorktreeId={`managed-agent-skill-setup-${active.skillName}-${active.context}`}
            terminalHeightPx={240}
            installed={installedState.installed}
            loading={loading}
            error={installedState.error}
            installLabel={contextActionLabel}
            installedInstallLabel={translate(
              'auto.components.skills.ManagedAgentSkillSetupDialogHost.update',
              'Update'
            )}
            preInstallNotice={AGENT_SKILL_CLI_PREREQUISITE_NOTICE}
            isPrerequisiteAvailable={isOrcaCliAvailableOnPath}
            onBeforeOpenTerminal={prepareManagedAgentSkillSetupTerminal}
            onRecheck={recheck}
          />
        ) : (
          <div className="px-6 pt-4 pb-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading}
              onClick={() => void recheck()}
            >
              <RefreshCw className={loading ? 'size-3.5 animate-spin' : 'size-3.5'} />
              {translate(
                'auto.components.skills.ManagedAgentSkillSetupDialogHost.recheck',
                'Re-check'
              )}
            </Button>
          </div>
        )}
        <DialogFooter className="px-6 pb-6">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              void (async () => {
                await updateSettings({ managedAgentSkillSetupPromptsEnabled: false })
                if (
                  useAppStore.getState().settings?.managedAgentSkillSetupPromptsEnabled !== false
                ) {
                  toast.error(
                    translate(
                      'auto.components.skills.ManagedAgentSkillSetupDialogHost.promptsDisableFailedToast',
                      "Couldn't turn off agent skill setup prompts"
                    ),
                    {
                      description: translate(
                        'auto.components.skills.ManagedAgentSkillSetupDialogHost.promptsDisableFailedToastDescription',
                        'Try again from Settings → Agents.'
                      ),
                      action: {
                        label: translate(
                          'auto.components.skills.ManagedAgentSkillSetupDialogHost.openSettings',
                          'Open Settings'
                        ),
                        onClick: () => {
                          openSettingsTarget({ pane: 'agents', repoId: null })
                          openSettingsPage()
                        }
                      }
                    }
                  )
                  return
                }
                toast.message(
                  translate(
                    'auto.components.skills.ManagedAgentSkillSetupDialogHost.promptsDisabledToast',
                    'Agent skill setup prompts are off'
                  ),
                  {
                    description: translate(
                      'auto.components.skills.ManagedAgentSkillSetupDialogHost.promptsDisabledToastDescription',
                      'Turn them back on in Settings → Agents.'
                    ),
                    action: {
                      label: translate(
                        'auto.components.skills.ManagedAgentSkillSetupDialogHost.openSettings',
                        'Open Settings'
                      ),
                      onClick: () => {
                        openSettingsTarget({ pane: 'agents', repoId: null })
                        openSettingsPage()
                      }
                    }
                  }
                )
                advanceQueue()
              })()
            }}
          >
            {translate(
              'auto.components.skills.ManagedAgentSkillSetupDialogHost.dontShowAgain',
              "Don't show again"
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              snoozedKeysRef.current.add(active.uiKey)
              advanceQueue()
            }}
          >
            {translate('auto.components.skills.ManagedAgentSkillSetupDialogHost.notNow', 'Not now')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

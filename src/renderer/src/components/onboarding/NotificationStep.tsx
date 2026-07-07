import { useCallback, useEffect, useRef, useState } from 'react'
import { BellRing, Check, FileAudio, Settings, TriangleAlert, Upload } from 'lucide-react'
import { toast } from 'sonner'
import type { GlobalSettings, NotificationDeliveryProbeResult } from '../../../../shared/types'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { sendNotificationSettingsTestNotification } from '@/components/settings/NotificationsPane'
import { getNotificationSoundOptions } from '@/components/notification-sound-options'
import { useMountedRef } from '@/hooks/useMountedRef'
import { translate } from '@/i18n/i18n'

type NotificationStepProps = {
  settings: GlobalSettings | null
  updateSettings: (updates: Partial<GlobalSettings>) => Promise<void> | void
}

const CHOOSE_CUSTOM_SOUND_VALUE = 'choose-custom-file'

export type MacNotificationPermissionState =
  | 'checking'
  | 'awaiting-permission'
  | 'enabled'
  | 'blocked'

const MAC_PROBE_POLL_INTERVAL_MS = 2500
// Why: bounded so an abandoned onboarding tab doesn't probe forever; ~3
// minutes comfortably covers answering the dialog or flipping the toggle
// in System Settings.
const MAC_PROBE_POLL_MAX_ATTEMPTS = 72

export function resolveMacNotificationPermissionState(
  probeState: NotificationDeliveryProbeResult['state'],
  promptedBefore: boolean
): MacNotificationPermissionState | null {
  if (probeState === 'unsupported') {
    return null
  }
  if (probeState === 'delivered') {
    return 'enabled'
  }
  // Why: a first-ever probe is what makes macOS show the permission dialog,
  // so its rejection means "unanswered", not "denied".
  return promptedBefore ? 'blocked' : 'awaiting-permission'
}

type NotificationSoundSelectValue =
  | GlobalSettings['notifications']['customSoundId']
  | typeof CHOOSE_CUSTOM_SOUND_VALUE

function isNotificationSoundId(
  value: NotificationSoundSelectValue
): value is GlobalSettings['notifications']['customSoundId'] {
  return value !== CHOOSE_CUSTOM_SOUND_VALUE
}

export function NotificationStep({
  settings,
  updateSettings
}: NotificationStepProps): React.JSX.Element {
  const notificationSettings = settings?.notifications
  const notificationSettingsRef = useRef(notificationSettings)
  const [macPermissionState, setMacPermissionState] =
    useState<MacNotificationPermissionState | null>(null)
  const [isPickingSound, setIsPickingSound] = useState(false)
  const [selectPortalRoot, setSelectPortalRoot] = useState<HTMLElement | null>(null)
  const syncedNotificationSettingsRef = useRef(notificationSettings)
  const mountedRef = useMountedRef()

  if (syncedNotificationSettingsRef.current !== notificationSettings) {
    syncedNotificationSettingsRef.current = notificationSettings
    // Why: handlers optimistically update the ref before persisted settings
    // flow back through props, so local re-renders must not overwrite it.
    notificationSettingsRef.current = notificationSettings
  }

  const setSelectPortalHost = useCallback((node: HTMLDivElement | null) => {
    // Why: onboarding sits above body-level portals, so the select menu must
    // portal into the overlay to stay clickable.
    setSelectPortalRoot(node?.closest<HTMLElement>('[data-onboarding-overlay]') ?? node)
  }, [])

  useEffect(() => {
    let cancelled = false
    let pollTimer: ReturnType<typeof setTimeout> | null = null
    let pollAttempts = 0

    // Why: probe rejections are silent, so polling while the card is not
    // green costs nothing visible and lets the card flip to "enabled" the
    // moment the user clicks Allow (or fixes the toggle in System Settings).
    function schedulePoll(): void {
      if (cancelled || pollAttempts >= MAC_PROBE_POLL_MAX_ATTEMPTS) {
        return
      }
      pollTimer = setTimeout(() => {
        pollAttempts += 1
        void window.api.notifications.probeDelivery({ force: true }).then((probe) => {
          if (cancelled) {
            return
          }
          if (probe.state === 'delivered') {
            setMacPermissionState('enabled')
            return
          }
          schedulePoll()
        })
      }, MAC_PROBE_POLL_INTERVAL_MS)
    }

    void (async () => {
      const status = await window.api.notifications.getPermissionStatus()
      if (cancelled) {
        return
      }
      if (status.platform !== 'darwin' || !status.supported) {
        return
      }
      setMacPermissionState('checking')
      // Why: `status.requested` is read before the probe stamps it, so a
      // fresh install (where the probe itself pops the macOS dialog) renders
      // as "answer the dialog" instead of "blocked".
      const probe = await window.api.notifications.probeDelivery()
      if (cancelled) {
        return
      }
      const resolved = resolveMacNotificationPermissionState(probe.state, status.requested)
      setMacPermissionState(resolved)
      if (resolved === 'awaiting-permission' || resolved === 'blocked') {
        schedulePoll()
      }
    })()

    return () => {
      cancelled = true
      if (pollTimer) {
        clearTimeout(pollTimer)
      }
    }
  }, [])

  const updateNotificationSettings = async (
    updates: Partial<GlobalSettings['notifications']>
  ): Promise<void> => {
    const current = notificationSettingsRef.current
    if (!current) {
      return
    }
    const nextNotifications = {
      ...current,
      ...updates
    }
    notificationSettingsRef.current = nextNotifications
    await updateSettings({
      notifications: nextNotifications
    })
  }

  const getCustomSoundVolume = (): number =>
    notificationSettingsRef.current?.customSoundVolume ?? 100

  const previewSound = async (
    customSoundId: GlobalSettings['notifications']['customSoundId']
  ): Promise<void> => {
    if (customSoundId === 'system') {
      return
    }
    const result = await window.api.notifications.playSound({
      force: true,
      volume: getCustomSoundVolume()
    })
    if (!result.played) {
      if (mountedRef.current) {
        toast.error(
          translate(
            'auto.components.onboarding.NotificationStep.b6a994e36e',
            'Notification sound could not be played'
          )
        )
      }
    }
  }

  const handleChooseCustomSound = async (): Promise<void> => {
    setIsPickingSound(true)
    try {
      const soundPath = await window.api.shell.pickAudio()
      if (soundPath) {
        await updateNotificationSettings({ customSoundId: 'custom', customSoundPath: soundPath })
        await previewSound('custom')
      }
    } finally {
      if (mountedRef.current) {
        setIsPickingSound(false)
      }
    }
  }

  const handleSoundSelect = async (value: NotificationSoundSelectValue): Promise<void> => {
    if (!isNotificationSoundId(value)) {
      await handleChooseCustomSound()
      return
    }
    await updateNotificationSettings({ customSoundId: value })
    await previewSound(value)
  }

  const handleSendTestNotification = async (): Promise<void> => {
    if (!notificationSettings) {
      toast.error(
        translate(
          'auto.components.onboarding.NotificationStep.3cd5374e22',
          'Notification settings are still loading'
        )
      )
      return
    }
    const showsMacPermissionCard = macPermissionState !== null
    const outcome = await sendNotificationSettingsTestNotification(
      notificationSettings,
      getCustomSoundVolume(),
      showsMacPermissionCard ? { suppressSystemPermissionToasts: true } : undefined
    )
    if (!mountedRef.current || !showsMacPermissionCard) {
      return
    }
    // Why: the test doubles as a permission re-check — its confirmed outcome
    // is fresher than whatever the mount-time probe reported.
    if (outcome === 'delivered') {
      setMacPermissionState('enabled')
    } else if (outcome === 'not-displayed') {
      setMacPermissionState('blocked')
    }
  }

  if (!notificationSettings) {
    return (
      <div className="rounded-xl border border-border bg-muted/20 px-5 py-4 text-sm text-muted-foreground">
        {translate(
          'auto.components.onboarding.NotificationStep.e52aacf380',
          'Loading notification settings…'
        )}
      </div>
    )
  }

  const customPath = notificationSettings.customSoundPath
  const selectedSoundId = notificationSettings.customSoundId
  const soundOptions = getNotificationSoundOptions(customPath)

  return (
    <div ref={setSelectPortalHost} className="space-y-5">
      {macPermissionState === 'checking' ? (
        <section className="rounded-xl border border-border bg-muted/20 px-5 py-4 text-[13px] text-muted-foreground">
          {translate(
            'auto.components.onboarding.NotificationStep.56b836215c',
            'Checking notification permission…'
          )}
        </section>
      ) : null}
      {macPermissionState === 'enabled' ? (
        <section className="flex items-center gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.07] px-5 py-4">
          <Check
            className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
            strokeWidth={3}
          />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-foreground">
              {translate(
                'auto.components.onboarding.NotificationStep.fd84d3e9b8',
                'Notifications are enabled'
              )}
            </div>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              {translate(
                'auto.components.onboarding.NotificationStep.4f7bce5644',
                'macOS will alert you when agents finish or terminals need attention.'
              )}
            </p>
          </div>
        </section>
      ) : null}
      {macPermissionState === 'awaiting-permission' ? (
        <section className="rounded-xl border border-border bg-card px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <BellRing className="size-4" />
                {translate(
                  'auto.components.onboarding.NotificationStep.95d99b52fa',
                  'Allow notifications for Orca'
                )}
              </div>
              <p className="max-w-[58ch] text-[13px] leading-relaxed text-muted-foreground">
                {translate(
                  'auto.components.onboarding.NotificationStep.94562ba367',
                  'macOS is asking for permission. Click Allow in the dialog and this step updates automatically.'
                )}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => void window.api.notifications.openSystemSettings()}
            >
              <Settings className="size-3.5" />
              {translate(
                'auto.components.onboarding.NotificationStep.4f6a1da718',
                'Open System Settings'
              )}
            </Button>
          </div>
        </section>
      ) : null}
      {macPermissionState === 'blocked' ? (
        <section className="rounded-xl border border-amber-500/30 bg-amber-500/[0.07] px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <TriangleAlert className="size-4 text-amber-600 dark:text-amber-400" />
                {translate(
                  'auto.components.onboarding.NotificationStep.90b5d2e363',
                  'macOS is not delivering Orca notifications'
                )}
              </div>
              <p className="max-w-[58ch] text-[13px] leading-relaxed text-muted-foreground">
                {translate(
                  'auto.components.onboarding.NotificationStep.2c47f5465f',
                  'Turn on Allow notifications for Orca in System Settings. This step updates automatically once enabled.'
                )}
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              className="gap-2"
              onClick={() => void window.api.notifications.openSystemSettings()}
            >
              <Settings className="size-3.5" />
              {translate(
                'auto.components.onboarding.NotificationStep.4f6a1da718',
                'Open System Settings'
              )}
            </Button>
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-foreground">
            {translate('auto.components.onboarding.NotificationStep.0af746e41f', 'Choose a sound')}
          </h2>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            {translate(
              'auto.components.onboarding.NotificationStep.0fe570690c',
              'Pick the alert Orca plays after a desktop notification is delivered.'
            )}
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <FileAudio className="size-4" />
            {translate(
              'auto.components.onboarding.NotificationStep.53aaffe49a',
              'Notification Sound'
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={selectedSoundId}
              disabled={isPickingSound}
              onValueChange={(value) =>
                void handleSoundSelect(value as NotificationSoundSelectValue)
              }
            >
              <SelectTrigger className="w-[360px] max-w-full" size="sm">
                <SelectValue
                  placeholder={translate(
                    'auto.components.onboarding.NotificationStep.dc897423e1',
                    'Choose notification sound'
                  )}
                />
              </SelectTrigger>
              <SelectContent
                portalContainer={selectPortalRoot}
                align="start"
                className="w-[--radix-select-trigger-width]"
              >
                {soundOptions.map((option) => {
                  const OptionIcon = option.icon
                  return (
                    <SelectItem key={option.id} value={option.id}>
                      <OptionIcon className="size-4" />
                      <span className="truncate">{option.title}</span>
                    </SelectItem>
                  )
                })}
                <SelectSeparator />
                <SelectItem value={CHOOSE_CUSTOM_SOUND_VALUE}>
                  <Upload className="size-4" />
                  <span>
                    {customPath
                      ? translate(
                          'auto.components.onboarding.NotificationStep.ac80d97e02',
                          'Change Custom File'
                        )
                      : translate(
                          'auto.components.onboarding.NotificationStep.c0692baa52',
                          'Choose Custom File'
                        )}
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => void handleSendTestNotification()}
            >
              <BellRing className="size-3.5" />
              {translate(
                'auto.components.onboarding.NotificationStep.3bede04483',
                'Send Test Notification'
              )}
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}

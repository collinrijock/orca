import { useCallback, useEffect, useRef, useState } from 'react'
import QRCodeBrowser from 'qrcode/lib/browser'
import { toast } from 'sonner'
import { useMountedRef } from '@/hooks/useMountedRef'
import { useAppStore } from '@/store'
import { PhoneCarousel } from './PhoneCarousel'
import { HeroFlow, HeroIntro, HeroPaired, type Platform, type StepIndex } from './MobileHero'
import { PLATFORM_COPY } from './mobile-platform-copy'
import {
  selectRefreshedNetworkAddress,
  type MobileNetworkInterface
} from '../settings/mobile-network-interface-selection'
import { MobilePageToolbar } from './MobilePageToolbar'
import { translate } from '@/i18n/i18n'
import { useMobilePagePairedDevices } from './use-mobile-page-paired-devices'

async function renderQrDataUrl(text: string): Promise<string> {
  return QRCodeBrowser.toDataURL(text, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 232
  })
}

export default function MobilePage(): React.JSX.Element {
  const [stepIdx, setStepIdx] = useState<StepIndex>(0)

  const [platform, setPlatform] = useState<Platform>('ios')
  const [installQrUrl, setInstallQrUrl] = useState<string | null>(null)

  const [pairQrDataUrl, setPairQrDataUrl] = useState<string | null>(null)
  const [pairingUrl, setPairingUrl] = useState<string | null>(null)
  const [pairLoading, setPairLoading] = useState(false)
  const [networkInterfaces, setNetworkInterfaces] = useState<MobileNetworkInterface[]>([])
  const [selectedAddress, setSelectedAddress] = useState<string | undefined>(undefined)
  const [refreshingNetworkInterfaces, setRefreshingNetworkInterfaces] = useState(false)
  const hasGeneratedRef = useRef(false)
  const mountedRef = useMountedRef()
  const closeMobilePage = useAppStore((s) => s.closeMobilePage)
  const showMobileButton = useAppStore((s) => s.settings?.showMobileButton !== false)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const {
    devices,
    enterFlow: showFirstPairingFlow,
    handleBack,
    pairAnotherDevice: showPairAnotherDeviceFlow,
    revokeDevice,
    revokingDeviceIds,
    showPairedDevices,
    stage
  } = useMobilePagePairedDevices({ stepIdx, setStepIdx })

  // Why: render install QRs lazily — only after the user enters the flow,
  // and re-render whenever the platform changes.
  useEffect(() => {
    if (stage !== 'flow') {
      return
    }
    // Clear the previous QR synchronously so the user never sees a stale
    // platform's image while the new one is rendering.
    setInstallQrUrl(null)
    let cancelled = false
    void (async () => {
      try {
        const dataUrl = await renderQrDataUrl(PLATFORM_COPY[platform].url)
        if (!cancelled) {
          setInstallQrUrl(dataUrl)
        }
      } catch {
        if (!cancelled) {
          setInstallQrUrl(null)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [platform, stage])

  const generatePairing = useCallback(
    async (rotate: boolean, addressOverride?: string) => {
      if (mountedRef.current) {
        setPairLoading(true)
      }
      try {
        const address = addressOverride ?? selectedAddress
        const result = await window.api.mobile.getPairingQR({
          ...(address ? { address } : {}),
          ...(rotate ? { rotate: true } : {})
        })
        if (result.available) {
          if (mountedRef.current) {
            setPairQrDataUrl(result.qrDataUrl)
            setPairingUrl(result.pairingUrl)
          }
          hasGeneratedRef.current = true
        } else {
          if (mountedRef.current) {
            toast.error(
              translate(
                'auto.components.mobile.MobilePage.b353e18de1',
                'WebSocket transport is not running'
              )
            )
          }
        }
      } catch {
        if (mountedRef.current) {
          toast.error(
            translate(
              'auto.components.mobile.MobilePage.4c8bd11c1a',
              'Failed to generate pairing code'
            )
          )
        }
      } finally {
        if (mountedRef.current) {
          setPairLoading(false)
        }
      }
    },
    [mountedRef, selectedAddress]
  )

  const loadNetworkInterfaces = useCallback(async () => {
    if (mountedRef.current) {
      setRefreshingNetworkInterfaces(true)
    }
    try {
      const result = await window.api.mobile.listNetworkInterfaces()
      if (mountedRef.current) {
        setNetworkInterfaces(result.interfaces)
      }
      // Resolve the new address before committing it so we can detect a real
      // change and remint the QR — otherwise the QR keeps encoding the stale
      // endpoint after a network refresh swaps the active interface.
      const newAddress = selectRefreshedNetworkAddress(selectedAddress, result.interfaces)
      if (mountedRef.current) {
        setSelectedAddress(newAddress)
      }
      if (newAddress !== selectedAddress && hasGeneratedRef.current && mountedRef.current) {
        void generatePairing(true, newAddress)
      }
    } catch {
      // Network list is non-critical; the QR will still mint with default routing.
    } finally {
      if (mountedRef.current) {
        setRefreshingNetworkInterfaces(false)
      }
    }
  }, [selectedAddress, generatePairing, mountedRef])

  useEffect(() => {
    if (stage !== 'flow') {
      return
    }
    void loadNetworkInterfaces()
  }, [stage, loadNetworkInterfaces])

  const handleAddressChange = useCallback(
    (address: string) => {
      setSelectedAddress(address)
      // Switching network must remint so the QR encodes the new endpoint.
      void generatePairing(true, address)
    },
    [generatePairing]
  )

  const copyPairingCode = useCallback(async () => {
    if (!pairingUrl) {
      return
    }
    try {
      await window.api.ui.writeClipboardText(pairingUrl)
      if (mountedRef.current) {
        toast.success(
          translate('auto.components.mobile.MobilePage.3c1f7168bb', 'Pairing code copied')
        )
      }
    } catch (err) {
      console.error('writeClipboardText failed', err)
      if (mountedRef.current) {
        toast.error(
          translate('auto.components.mobile.MobilePage.6a66e38943', 'Failed to copy pairing code')
        )
      }
    }
  }, [mountedRef, pairingUrl])

  // Why: when Step 2 first becomes visible, mint a pairing offer so the
  // user sees a real QR immediately. Subsequent visits keep the existing
  // token unless they hit Regenerate.
  useEffect(() => {
    if (stage !== 'flow' || stepIdx !== 1 || hasGeneratedRef.current) {
      return
    }
    void generatePairing(false)
  }, [stage, stepIdx, generatePairing])

  const enterFlow = (): void => {
    // Force the auto-generate effect to mint a fresh pairing token on next
    // entry into Step 2, and clear stale QR state so we never flash an
    // expired code from a previous session.
    hasGeneratedRef.current = false
    setPairQrDataUrl(null)
    setPairingUrl(null)
    showFirstPairingFlow()
  }

  // Why: from the paired summary, "Pair another device" jumps straight to
  // Step 2 since the app is presumably already installed on the user's phone.
  const pairAnotherDevice = (): void => {
    // Same reset as enterFlow — re-entering must mint a fresh pairing offer.
    hasGeneratedRef.current = false
    setPairQrDataUrl(null)
    setPairingUrl(null)
    showPairAnotherDeviceFlow()
  }

  const handleContinue = (): void => {
    if (stepIdx === 0) {
      setStepIdx(1)
    }
  }

  const openInstallUrl = (): void => {
    void window.api.shell.openUrl(PLATFORM_COPY[platform].url)
  }

  const copyInstallUrl = async (): Promise<void> => {
    try {
      await window.api.ui.writeClipboardText(PLATFORM_COPY[platform].url)
      if (mountedRef.current) {
        toast.success(
          translate('auto.components.mobile.MobilePage.fad833de8d', 'Install link copied')
        )
      }
    } catch (err) {
      console.error('writeClipboardText failed', err)
      if (mountedRef.current) {
        toast.error(
          translate('auto.components.mobile.MobilePage.baea63c445', 'Failed to copy link')
        )
      }
    }
  }

  const toggleMobileSidebarButton = useCallback(() => {
    void updateSettings({ showMobileButton: !showMobileButton })
  }, [showMobileButton, updateSettings])

  // Why: mirror Automations/Tasks — Esc first exits field focus, then closes the page.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape' || event.defaultPrevented) {
        return
      }
      const target = event.target
      if (!(target instanceof HTMLElement)) {
        return
      }
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target.isContentEditable
      ) {
        event.preventDefault()
        target.blur()
        return
      }
      event.preventDefault()
      closeMobilePage()
    }
    // Why: bubble phase (no capture) so Radix popovers/selects get a chance
    // to consume Escape first; the defaultPrevented check below then skips.
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closeMobilePage])

  return (
    <div className="mobile-page-root">
      <MobilePageToolbar
        showMobileButton={showMobileButton}
        onClose={closeMobilePage}
        onToggleMobileSidebarButton={toggleMobileSidebarButton}
      />
      <section className="mp-hero">
        <div className="mp-hero-copy">
          {stage === null ? null : stage === 'intro' ? (
            <HeroIntro onStart={enterFlow} />
          ) : stage === 'paired' ? (
            <HeroPaired
              devices={devices}
              onPairAnother={pairAnotherDevice}
              onRevoke={(id) => void revokeDevice(id)}
              revokingDeviceIds={revokingDeviceIds}
            />
          ) : (
            <HeroFlow
              stepIdx={stepIdx}
              platform={platform}
              onPlatformChange={setPlatform}
              installQrUrl={installQrUrl}
              installCopy={PLATFORM_COPY[platform]}
              onOpenInstallUrl={openInstallUrl}
              onCopyInstallUrl={() => void copyInstallUrl()}
              pairQrDataUrl={pairQrDataUrl}
              pairingUrl={pairingUrl}
              pairLoading={pairLoading}
              onRegeneratePairing={() => void generatePairing(true)}
              onCopyPairingCode={() => void copyPairingCode()}
              networkInterfaces={networkInterfaces}
              selectedAddress={selectedAddress}
              onSelectedAddressChange={handleAddressChange}
              onRefreshNetworkInterfaces={() => void loadNetworkInterfaces()}
              refreshingNetworkInterfaces={refreshingNetworkInterfaces}
              onBack={handleBack}
              onContinue={handleContinue}
              onDone={devices.length > 0 ? () => showPairedDevices(devices.length) : undefined}
            />
          )}
        </div>

        <div
          className="mp-stage"
          aria-label={translate('auto.components.mobile.MobilePage.e17393c6a3', 'Phone preview')}
        >
          <PhoneCarousel />
        </div>
      </section>
    </div>
  )
}

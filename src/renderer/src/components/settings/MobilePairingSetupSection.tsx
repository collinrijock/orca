import type { ReactNode } from 'react'
import { ExternalLink, Loader2, QrCode, RefreshCw } from 'lucide-react'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { translate } from '@/i18n/i18n'
import { NetworkInterfacePicker } from '../mobile/NetworkInterfacePicker'
import type { MobileNetworkInterface } from './mobile-network-interface-selection'
import type { MobilePairingConnectionMode } from '../../../../shared/mobile-pairing-connection-mode'

const TAILSCALE_DOWNLOAD_URL = 'https://tailscale.com/download'

type MobilePairingSetupSectionProps = {
  connectionMode: MobilePairingConnectionMode
  relayConnectionControl: ReactNode
  networkInterfaces: MobileNetworkInterface[]
  selectedAddress: string | undefined
  onSelectedAddressChange: (address: string) => void
  refreshingNetworkInterfaces: boolean
  onRefreshNetworkInterfaces: () => void
  loading: boolean
  hasQrCode: boolean
  onGenerateQr: () => void
}

export function MobilePairingSetupSection({
  connectionMode,
  relayConnectionControl,
  networkInterfaces,
  selectedAddress,
  onSelectedAddressChange,
  refreshingNetworkInterfaces,
  onRefreshNetworkInterfaces,
  loading,
  hasQrCode,
  onGenerateQr
}: MobilePairingSetupSectionProps): React.JSX.Element {
  return (
    <section className="space-y-5">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">
          {translate('auto.components.settings.MobilePairingSetupSection.title', 'Pair a phone')}
        </h3>
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.settings.MobilePairingSetupSection.overview',
            'Your phone needs a path to this computer. Pick a direct address first (same Wi‑Fi or Tailscale). Optionally add Orca Relay as a fallback when that address is unreachable.'
          )}
        </p>
      </div>

      <div className="space-y-3">
        <div className="space-y-1">
          <h4 className="text-xs font-medium">
            {translate(
              'auto.components.settings.MobilePairingSetupSection.directTitle',
              '1. Direct address'
            )}
          </h4>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.MobilePairingSetupSection.directDescription',
              'On the same Wi‑Fi, pick a LAN address. Away from this network, install Tailscale on both devices, join the same tailnet, then pick the 100.x address.'
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <NetworkInterfacePicker
            networkInterfaces={networkInterfaces}
            selectedAddress={selectedAddress}
            onSelectedAddressChange={onSelectedAddressChange}
            className="min-w-[220px] justify-between font-normal"
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={onRefreshNetworkInterfaces}
                disabled={refreshingNetworkInterfaces}
                aria-label={translate(
                  'auto.components.settings.MobilePairingSetupSection.refresh',
                  'Refresh network interfaces'
                )}
                className="text-muted-foreground"
              >
                <RefreshCw className={refreshingNetworkInterfaces ? 'animate-spin' : ''} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {translate(
                'auto.components.settings.MobilePairingSetupSection.refresh',
                'Refresh network interfaces'
              )}
            </TooltipContent>
          </Tooltip>
        </div>
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.settings.MobilePairingSetupSection.tailscaleHint',
            'No Tailscale yet?'
          )}{' '}
          <button
            type="button"
            onClick={() => void window.api.shell.openUrl(TAILSCALE_DOWNLOAD_URL)}
            className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-2 hover:underline"
          >
            {translate(
              'auto.components.settings.MobilePairingSetupSection.getTailscale',
              'Get Tailscale'
            )}
            <ExternalLink className="size-3" />
          </button>
          {translate(
            'auto.components.settings.MobilePairingSetupSection.tailscaleHintSuffix',
            ' — then refresh and select its 100.x.y.z address.'
          )}
        </p>
      </div>

      <div className="space-y-2 border-t border-border/60 pt-4">
        <div className="space-y-1">
          <h4 className="text-xs font-medium">
            {translate(
              'auto.components.settings.MobilePairingSetupSection.relayTitle',
              '2. Optional Relay fallback'
            )}
          </h4>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.MobilePairingSetupSection.relaySectionDescription',
              'Use this when you are not on the same network and do not want to set up Tailscale. The phone still prefers the direct address above when it works.'
            )}
          </p>
        </div>
        {relayConnectionControl}
      </div>

      <div className="space-y-2 border-t border-border/60 pt-4">
        <div className="space-y-1">
          <h4 className="text-xs font-medium">
            {translate(
              'auto.components.settings.MobilePairingSetupSection.generateTitle',
              '3. Generate pairing code'
            )}
          </h4>
          <p className="text-xs text-muted-foreground">
            {connectionMode === 'automatic'
              ? translate(
                  'auto.components.settings.MobilePairingSetupSection.generateAutomaticDescription',
                  'The code includes the direct address above, plus encrypted Orca Relay as a fallback.'
                )
              : translate(
                  'auto.components.settings.MobilePairingSetupSection.generateLocalDescription',
                  'The code connects only through the direct address above — no Relay.'
                )}
          </p>
        </div>
        <Button
          onClick={onGenerateQr}
          disabled={loading || !selectedAddress}
          size="sm"
          className="gap-1.5"
        >
          {loading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : hasQrCode ? (
            <RefreshCw className="size-3.5" />
          ) : (
            <QrCode className="size-3.5" />
          )}
          {hasQrCode
            ? translate(
                'auto.components.settings.MobilePairingSetupSection.regenerate',
                'Regenerate'
              )
            : translate(
                'auto.components.settings.MobilePairingSetupSection.generate',
                'Generate QR Code'
              )}
        </Button>
      </div>
    </section>
  )
}

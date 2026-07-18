// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MobilePairingSetupSection } from './MobilePairingSetupSection'
import type { MobileNetworkInterface } from './mobile-network-interface-selection'
import { TooltipProvider } from '../ui/tooltip'

afterEach(() => cleanup())

const LAN: MobileNetworkInterface = { name: 'en0', address: '192.168.1.24' }
const TAILNET: MobileNetworkInterface = { name: 'tailscale0', address: '100.64.1.20' }

function renderSection(
  overrides: Partial<React.ComponentProps<typeof MobilePairingSetupSection>> = {}
) {
  const onSelectedAddressChange = vi.fn()
  const onRefreshNetworkInterfaces = vi.fn()
  const onGenerateQr = vi.fn()
  const props: React.ComponentProps<typeof MobilePairingSetupSection> = {
    connectionMode: 'local-only',
    relayConnectionControl: <div data-testid="relay-control">relay</div>,
    networkInterfaces: [LAN, TAILNET],
    selectedAddress: TAILNET.address,
    onSelectedAddressChange,
    refreshingNetworkInterfaces: false,
    onRefreshNetworkInterfaces,
    loading: false,
    hasQrCode: false,
    onGenerateQr,
    ...overrides
  }
  const user = userEvent.setup()
  const rendered = render(
    <TooltipProvider>
      <MobilePairingSetupSection {...props} />
    </TooltipProvider>
  )
  return { ...rendered, user, onSelectedAddressChange, onGenerateQr }
}

describe('MobilePairingSetupSection', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        shell: { openUrl: vi.fn().mockResolvedValue(undefined) }
      }
    })
  })

  it('explains the direct path, Relay fallback, and generate steps in order', () => {
    renderSection()
    expect(screen.getByText('1. Direct address')).toBeVisible()
    expect(screen.getByText('2. Optional Relay fallback')).toBeVisible()
    expect(screen.getByText('3. Generate pairing code')).toBeVisible()
    expect(screen.getByTestId('relay-control')).toBeVisible()
    expect(screen.getByRole('combobox')).toHaveTextContent('100.64.1.20 (tailscale0)')
    expect(screen.getByText(/connects only through the direct address above/i)).toBeVisible()
  })

  it('describes automatic pairing as direct-first with Relay fallback', () => {
    renderSection({ connectionMode: 'automatic' })
    expect(screen.getByRole('combobox')).toBeVisible()
    expect(
      screen.getByText(/includes the direct address above, plus encrypted Orca Relay/i)
    ).toBeVisible()
  })

  it('commits an OS interface picked from the list', async () => {
    const { user, onSelectedAddressChange } = renderSection()
    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: '192.168.1.24 (en0)' }))
    expect(onSelectedAddressChange).toHaveBeenCalledWith('192.168.1.24')
  })

  it('opens Tailscale download from the direct-address hint', async () => {
    const { user } = renderSection()
    await user.click(screen.getByRole('button', { name: /Get Tailscale/i }))
    expect(window.api.shell.openUrl).toHaveBeenCalledWith('https://tailscale.com/download')
  })

  it('generates a pairing code with the selected mode', async () => {
    const { user, onGenerateQr } = renderSection()
    await user.click(screen.getByRole('button', { name: 'Generate QR Code' }))
    expect(onGenerateQr).toHaveBeenCalledOnce()
  })
})

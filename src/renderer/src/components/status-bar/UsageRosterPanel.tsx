import React from 'react'
import { ChevronRight, RefreshCw } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { formatWindowLabel } from '@/lib/window-label-formatter'
import type { ProviderRateLimits, RateLimitWindow } from '../../../../shared/rate-limit-types'
import {
  clampUsedPercent,
  getDisplayedUsagePercentage,
  type UsagePercentageDisplay
} from '../../../../shared/usage-percentage-display'
import { barColor, formatResetCountdown, getWindowSections, ProviderIcon } from './tooltip'
import { getProviderDisplayName } from './usage-error-copy'
import { formatPlanLabel, usageTextColorClass } from './usage-roster-formatting'

type ProviderId = ProviderRateLimits['provider']
type Section = { label: string; window: RateLimitWindow }

// Windows/buckets that actually carry data — the null ones are absent limits.
function usedSections(p: ProviderRateLimits): Section[] {
  return getWindowSections(p).filter((s): s is Section => s.window !== null)
}

function providerMaxUsed(sections: Section[]): number {
  return sections.length > 0
    ? Math.max(...sections.map((s) => clampUsedPercent(s.window.usedPercent)))
    : 0
}

// Buckets (Gemini Flash/Pro) keep their model name; windows use their duration.
function shortLabel(p: ProviderRateLimits, section: Section): string {
  if (p.buckets?.some((b) => b.name === section.label)) {
    return section.label
  }
  // fableWeekly shares the 7d window with weekly; label it distinctly so the two
  // don't both render as "wk".
  if (section.window === p.fableWeekly) {
    return 'Fable'
  }
  return formatWindowLabel(section.window.windowMinutes)
}

// The soonest-resetting window summarizes the agent's next reset in one line.
function soonestResetLabel(sections: Section[]): string | null {
  const resets = sections
    .map((s) => s.window.resetsAt)
    .filter((r): r is number => typeof r === 'number')
  if (resets.length === 0) {
    return null
  }
  return formatResetCountdown(Math.min(...resets) - Date.now())
}

// Presentational row: a compact header (icon · name · plan · reset) with
// the per-window metrics beneath, so the reset stays visible and multi-window
// agents stay short. The wrapper supplies padding + interaction (drill-in
// submenu or plain clickable row).
export function UsageRow({
  p,
  display,
  onSignIn
}: {
  p: ProviderRateLimits
  display: UsagePercentageDisplay
  onSignIn: (provider: ProviderId) => void
}): React.JSX.Element {
  const sections = usedSections(p)
  const signedOut = sections.length === 0
  const name = getProviderDisplayName(p.provider)
  const plan = formatPlanLabel(p.planType)
  const reset = signedOut ? null : soonestResetLabel(sections)

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <div className="flex items-center gap-2.5">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-md border border-border bg-secondary">
          <ProviderIcon provider={p.provider} />
        </span>
        <span className="min-w-0 shrink truncate text-[13px] font-medium text-foreground">
          {name}
          {plan ? <span className="font-normal text-muted-foreground"> · {plan}</span> : null}
        </span>
        {!signedOut && reset ? (
          <span className="shrink-0 text-[11px] text-muted-foreground">{reset}</span>
        ) : null}
        {signedOut ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onSignIn(p.provider)
            }}
            className="ml-auto shrink-0 rounded-md border border-border bg-secondary px-2.5 py-0.5 text-xs text-foreground hover:bg-accent"
          >
            {translate('auto.components.status.bar.StatusBar.c35af53b73', 'Sign in')}
          </button>
        ) : null}
      </div>
      {signedOut ? (
        <div className="pl-[30px] text-[11px] text-muted-foreground">
          {translate('auto.components.status.bar.UsageRosterPanel.notSignedIn', 'not signed in')}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 pl-[30px]">
          {sections.map((s) => {
            const used = clampUsedPercent(s.window.usedPercent)
            const shown = getDisplayedUsagePercentage(s.window.usedPercent, display)
            return (
              <span key={s.label} className="flex items-center gap-1.5">
                <span className="text-[10px] text-muted-foreground">{shortLabel(p, s)}</span>
                <span className="h-[5px] w-7 overflow-hidden rounded-full bg-muted">
                  <span
                    className={`block h-full rounded-full ${barColor(used)}`}
                    style={{ width: `${used}%` }}
                  />
                </span>
                <span className={`tabular-nums text-[11px] ${usageTextColorClass(used)}`}>
                  {shown}%
                </span>
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * Consolidated "Usage" popover — one row per agent (icon · name · reset ·
 * per-window bars), opened from the status-bar roster pill. Deep per-agent
 * actions route to Settings via the callbacks.
 */
export function UsageRosterPanel({
  providers,
  display,
  isRefreshing,
  onRefresh,
  onOpenProvider,
  onSignIn,
  onManageAccounts,
  onUsageDetails,
  renderRow
}: {
  providers: ProviderRateLimits[]
  display: UsagePercentageDisplay
  isRefreshing: boolean
  onRefresh: () => void
  onOpenProvider: (provider: ProviderId) => void
  onSignIn: (provider: ProviderId) => void
  onManageAccounts: () => void
  onUsageDetails: () => void
  // Lets the host wrap a provider's row in a richer control (e.g. the
  // Claude/Codex account-switch drill-in submenu); return null to use the
  // default clickable row.
  renderRow?: (p: ProviderRateLimits, row: React.ReactNode) => React.ReactNode
}): React.JSX.Element {
  // Worst-first so the agent nearest a limit sits on top.
  const sorted = [...providers].sort(
    (a, b) => providerMaxUsed(usedSections(b)) - providerMaxUsed(usedSections(a))
  )

  return (
    <div className="w-[360px] text-xs">
      <div className="flex items-center justify-between px-3.5 pb-2 pt-3">
        <span className="text-[13px] font-semibold text-foreground">
          {translate('auto.components.status.bar.UsageRosterPanel.title', 'Usage')}
        </span>
        <div className="flex items-center gap-2 text-muted-foreground">
          <span className="text-[11px]">
            {translate('auto.components.status.bar.UsageRosterPanel.allAgents', 'all agents')}
          </span>
          <button
            type="button"
            onClick={onRefresh}
            aria-label={translate(
              'auto.components.status.bar.StatusBar.3325d996cb',
              'Refresh rate limits'
            )}
            className="rounded p-0.5 hover:bg-accent hover:text-foreground"
          >
            <RefreshCw size={12} className={isRefreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>
      <div className="border-t border-border/70" />
      {sorted.map((p) => {
        const rowNode = <UsageRow p={p} display={display} onSignIn={onSignIn} />
        const custom = renderRow?.(p, rowNode)
        if (custom) {
          return <React.Fragment key={p.provider}>{custom}</React.Fragment>
        }
        return (
          <div
            key={p.provider}
            role="button"
            tabIndex={0}
            onClick={() => onOpenProvider(p.provider)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onOpenProvider(p.provider)
              }
            }}
            className="flex cursor-pointer items-center px-3.5 py-2.5 hover:bg-accent/60"
          >
            {rowNode}
          </div>
        )
      })}
      <div className="border-t border-border/70" />
      <button
        type="button"
        onClick={onUsageDetails}
        className="flex w-full items-center justify-between px-3.5 py-2.5 text-[13px] text-foreground hover:bg-accent/60"
      >
        {translate(
          'auto.components.status.bar.UsageRosterPanel.usageDetails',
          'Usage details & history'
        )}
        <ChevronRight size={14} className="text-muted-foreground" />
      </button>
      <button
        type="button"
        onClick={onManageAccounts}
        className="flex w-full items-center justify-between px-3.5 py-2.5 text-[13px] text-foreground hover:bg-accent/60"
      >
        {translate('auto.components.status.bar.StatusBar.75ded02687', 'Manage Accounts…')}
        <ChevronRight size={14} className="text-muted-foreground" />
      </button>
    </div>
  )
}

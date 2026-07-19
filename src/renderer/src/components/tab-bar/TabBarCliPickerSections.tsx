import type React from 'react'
import { Loader2, RefreshCw, Settings } from 'lucide-react'
import { AgentIcon } from '@/lib/agent-catalog'
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import type { TabAgentLaunchOption } from './tab-agent-launch-options'

const SECTION_LABEL_CLASSES =
  'px-2 pb-1 pt-2 text-[10px] font-semibold uppercase leading-none tracking-[0.05em] text-muted-foreground/80'

export function TabBarCliPickerAgentSection({
  agentOptions,
  hasDetectedAgents,
  isLoading,
  onLaunchAgent
}: {
  agentOptions: readonly TabAgentLaunchOption[]
  hasDetectedAgents: boolean
  isLoading: boolean
  onLaunchAgent: (option: TabAgentLaunchOption) => void
}): React.JSX.Element {
  return (
    <>
      <DropdownMenuLabel className={SECTION_LABEL_CLASSES}>
        {translate('auto.components.tab.bar.TabBarCliPickerSections.codingClis', 'Coding CLIs')}
      </DropdownMenuLabel>
      {agentOptions.length > 0 ? (
        agentOptions.map((option) => (
          <DropdownMenuItem
            key={option.agent}
            data-cli-picker-agent={option.agent}
            onSelect={() => onLaunchAgent(option)}
            className="min-h-9 gap-2 rounded-sm px-2 py-1 text-[12px] leading-tight"
          >
            <AgentIcon agent={option.agent} size={14} />
            <span className="flex min-w-0 flex-1 items-baseline gap-2">
              <span className="truncate font-medium text-foreground">{option.label}</span>
              <code className="truncate font-mono text-[11px] text-muted-foreground">
                {option.command}
              </code>
            </span>
            {option.isDefault ? (
              <span className="shrink-0 rounded-sm border border-border/80 px-1 py-0.5 text-[9px] font-medium uppercase tracking-[0.05em] text-muted-foreground">
                {translate('auto.components.tab.bar.TabBarCliPickerSections.default', 'Default')}
              </span>
            ) : null}
          </DropdownMenuItem>
        ))
      ) : (
        <div
          className="flex min-h-8 items-center gap-2 px-2 text-[11px] text-muted-foreground"
          role="status"
        >
          {isLoading ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
          {isLoading
            ? translate(
                'auto.components.tab.bar.TabBarCliPickerSections.loadingClis',
                'Looking for installed CLIs…'
              )
            : hasDetectedAgents
              ? translate(
                  'auto.components.tab.bar.TabBarCliPickerSections.noEnabledClis',
                  'No enabled CLIs'
                )
              : translate(
                  'auto.components.tab.bar.TabBarCliPickerSections.noClis',
                  'No installed CLIs found'
                )}
        </div>
      )}
    </>
  )
}

export function TabBarCliPickerSectionLabel({
  children
}: {
  children: React.ReactNode
}): React.JSX.Element {
  return <DropdownMenuLabel className={SECTION_LABEL_CLASSES}>{children}</DropdownMenuLabel>
}

export function TabBarCliPickerFooter({
  isRefreshing,
  onOpenSettings,
  onRefresh
}: {
  isRefreshing: boolean
  onOpenSettings: () => void
  onRefresh: () => void
}): React.JSX.Element {
  return (
    <>
      <DropdownMenuSeparator />
      <div className="grid grid-cols-2 gap-1 p-1">
        <DropdownMenuItem
          disabled={isRefreshing}
          onSelect={(event) => {
            event.preventDefault()
            onRefresh()
          }}
          className="min-h-8 justify-center gap-1.5 rounded-sm px-2 text-[11px] text-muted-foreground"
        >
          <RefreshCw
            className={isRefreshing ? 'size-3 animate-spin' : 'size-3'}
            aria-hidden="true"
          />
          {translate('auto.components.tab.bar.TabBarCliPickerSections.refreshClis', 'Refresh CLIs')}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={onOpenSettings}
          className="min-h-8 justify-center gap-1.5 rounded-sm px-2 text-[11px] text-muted-foreground"
        >
          <Settings className="size-3" aria-hidden="true" />
          {translate(
            'auto.components.tab.bar.TabBarCliPickerSections.cliSettings',
            'CLI settings…'
          )}
        </DropdownMenuItem>
      </div>
    </>
  )
}

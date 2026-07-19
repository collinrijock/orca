import React from 'react'
import { FilePlus, FileText, Globe, Loader2, Smartphone, TerminalSquare } from 'lucide-react'
import { AgentIcon } from '@/lib/agent-catalog'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { ActiveOption } from './tab-create-entry-active-option'

export const RESULT_LISTBOX_ID = 'tab-create-entry-results'

// Index-based (not the option id, which may contain spaces/slashes from file
// paths) so it is always a valid aria-activedescendant IDREF.
export function resultOptionDomId(index: number): string {
  return `tab-create-entry-result-${index}`
}

export function EntryStatusRow({
  loading = false,
  message
}: {
  loading?: boolean
  message: string
}): React.JSX.Element {
  return (
    <div className="flex min-h-6 items-center gap-1.5 rounded-[7px] px-1 text-[11px] leading-5 text-muted-foreground">
      {loading ? <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden="true" /> : null}
      <span className="truncate">{message}</span>
    </div>
  )
}

export function EntryActionRow({
  id,
  onClick,
  option,
  selected
}: {
  id: string
  onClick: () => void
  option: ActiveOption
  selected: boolean
}): React.JSX.Element {
  const presentation = getActionPresentation(option)

  return (
    <button
      type="button"
      id={id}
      role="option"
      aria-selected={selected}
      data-cli-picker-agent={option.kind === 'agent' ? option.option.agent : undefined}
      className={cn(
        'flex min-h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-[11px] leading-5 outline-none focus-visible:ring-1 focus-visible:ring-ring',
        selected
          ? 'bg-black/8 text-accent-foreground dark:bg-white/14'
          : 'text-muted-foreground hover:bg-black/8 hover:text-accent-foreground dark:hover:bg-white/14'
      )}
      onClick={onClick}
    >
      {presentation.icon}
      <span className={cn('min-w-0 truncate font-medium', presentation.showDetail && 'shrink-0')}>
        {presentation.label}
      </span>
      {presentation.showDetail ? (
        <>
          <span className="text-muted-foreground/70" aria-hidden="true">
            ·
          </span>
          <span
            className={cn(
              'min-w-0 truncate',
              presentation.detailMonospace && 'font-mono text-[10px]'
            )}
          >
            {presentation.detail}
          </span>
        </>
      ) : null}
      {presentation.isDefault ? (
        <span className="ml-auto shrink-0 rounded-sm border border-border/80 px-1 text-[9px] font-medium uppercase tracking-[0.05em] text-muted-foreground">
          {translate('auto.components.tab.bar.TabBarCliPickerSections.default', 'Default')}
        </span>
      ) : null}
    </button>
  )
}

function getActionPresentation(option: ActiveOption): {
  detail: string
  detailMonospace: boolean
  icon: React.ReactNode
  isDefault: boolean
  label: string
  showDetail: boolean
} {
  if (option.kind === 'menu') {
    const icon =
      option.option.kind === 'new-browser' ? (
        <Globe className="size-3.5 shrink-0" aria-hidden="true" />
      ) : option.option.kind === 'new-markdown' ? (
        <FilePlus className="size-3.5 shrink-0" aria-hidden="true" />
      ) : option.option.kind === 'open-markdown' ? (
        <FileText className="size-3.5 shrink-0" aria-hidden="true" />
      ) : option.option.kind === 'new-simulator' || option.option.kind === 'go-to-simulator' ? (
        <Smartphone className="size-3.5 shrink-0" aria-hidden="true" />
      ) : (
        <TerminalSquare className="size-3.5 shrink-0" aria-hidden="true" />
      )
    return {
      detail: '',
      detailMonospace: false,
      icon,
      isDefault: false,
      label: option.option.label,
      showDetail: false
    }
  }
  if (option.kind === 'agent') {
    return {
      detail: option.option.command,
      detailMonospace: true,
      icon: <AgentIcon agent={option.option.agent} size={14} />,
      isDefault: option.option.isDefault,
      label: option.option.label,
      showDetail: true
    }
  }
  const { classification } = option.option
  if (classification.kind === 'explicit-url' || classification.kind === 'host-url') {
    return {
      detail: classification.url,
      detailMonospace: false,
      icon: <Globe className="size-3.5 shrink-0" aria-hidden="true" />,
      isDefault: false,
      label: translate('auto.components.tab.bar.TabBarCreateEntry.7cdf8ee0c8', 'Open URL'),
      showDetail: true
    }
  }
  if (classification.kind === 'existing-file') {
    return {
      detail: classification.relativePath,
      detailMonospace: false,
      icon: <FileText className="size-3.5 shrink-0" aria-hidden="true" />,
      isDefault: false,
      label: translate('auto.components.tab.bar.TabBarCreateEntry.25dc1cd653', 'Open file'),
      showDetail: true
    }
  }
  return {
    detail: classification.relativePath,
    detailMonospace: false,
    icon: <FilePlus className="size-3.5 shrink-0" aria-hidden="true" />,
    isDefault: false,
    label: translate('auto.components.tab.bar.TabBarCreateEntry.d62d63b807', 'Create file'),
    showDetail: true
  }
}

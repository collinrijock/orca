import { Check, ChevronsUpDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Command, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import type { SidebarHostOption } from './sidebar-host-options'
import { getSidebarHostHealthLabel, shouldShowHostScopeControls } from './sidebar-host-options'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import { describeRuntimeCompatBlock } from '../../../../shared/protocol-compat'
import { translate } from '@/i18n/i18n'
import { canSelectAddRepoHost } from './add-repo-host-availability'

type AddRepoHostSelectorProps = {
  hosts: SidebarHostOption[]
  selectedHostId: ExecutionHostId
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelectHost: (hostId: ExecutionHostId) => void
}

function getHostKindLabel(host: SidebarHostOption): string {
  switch (host.kind) {
    case 'local':
      return translate('auto.components.sidebar.AddRepoHostSelector.local', 'Local')
    case 'ssh':
      return translate('auto.components.sidebar.AddRepoHostSelector.ssh', 'SSH')
    case 'runtime':
      return translate('auto.components.sidebar.AddRepoHostSelector.runtime', 'Server')
  }
}

function getHostStatusDetail(host: SidebarHostOption): string {
  if (host.compatibility?.kind === 'blocked') {
    return describeRuntimeCompatBlock(host.compatibility)
  }
  return `${getSidebarHostHealthLabel(host.health)}${host.detail ? ` - ${host.detail}` : ''}`
}

export function AddRepoHostSelector({
  hosts,
  selectedHostId,
  open,
  onOpenChange,
  onSelectHost
}: AddRepoHostSelectorProps): React.JSX.Element | null {
  if (!shouldShowHostScopeControls(hosts)) {
    return null
  }

  const selectedHost = hosts.find((host) => host.id === selectedHostId) ?? hosts[0]
  if (!selectedHost) {
    return null
  }
  const selectedHealthLabel = getSidebarHostHealthLabel(selectedHost.health)

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-medium text-muted-foreground">
          {translate('auto.components.sidebar.AddRepoHostSelector.host', 'Host')}
        </span>
        <Popover open={open} onOpenChange={onOpenChange}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="h-10 min-w-56 justify-between px-3 text-xs font-normal"
            >
              <span className="min-w-0 flex flex-col items-start leading-tight">
                <span className="max-w-40 truncate">{selectedHost.label}</span>
                {selectedHost.health !== 'local' && (
                  <span
                    title={getHostStatusDetail(selectedHost)}
                    className={cn(
                      'max-w-40 truncate text-[10px]',
                      selectedHost.health === 'available'
                        ? 'text-muted-foreground'
                        : 'text-destructive'
                    )}
                  >
                    {selectedHealthLabel}
                  </span>
                )}
              </span>
              <ChevronsUpDown className="size-3.5 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-[min(340px,calc(100vw-1rem))] min-w-[var(--radix-popover-trigger-width)] p-0"
          >
            <Command>
              <CommandList>
                {hosts.map((host) => {
                  const selected = host.id === selectedHostId
                  const disabled = !canSelectAddRepoHost(host)
                  return (
                    <CommandItem
                      key={host.id}
                      value={`${host.label} ${host.detail}`}
                      disabled={disabled}
                      onSelect={() => {
                        if (disabled) {
                          return
                        }
                        onSelectHost(host.id)
                        onOpenChange(false)
                      }}
                      className={cn(
                        'items-start gap-2 px-3 py-2 text-xs',
                        disabled && 'cursor-not-allowed opacity-55'
                      )}
                    >
                      <Check
                        className={cn(
                          'mt-0.5 size-3 text-muted-foreground',
                          selected ? 'opacity-70' : 'opacity-0'
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate font-medium">{host.label}</span>
                          <span className="shrink-0 rounded-sm border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                            {getHostKindLabel(host)}
                          </span>
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                          {getHostStatusDetail(host)}
                        </span>
                      </span>
                    </CommandItem>
                  )
                })}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}

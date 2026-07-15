import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, Loader2, RefreshCw } from 'lucide-react'
import type { SkillFreshnessInventory } from '../../../../shared/skill-freshness'
import { buildTargetedSkillUpdateCommand } from '../../../../shared/skill-freshness'
import { useSkillFreshness } from '@/hooks/useSkillFreshness'
import { notifyInstalledAgentSkillsChanged } from '@/hooks/useInstalledAgentSkills'
import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { OnboardingInlineCommandTerminal } from '@/components/onboarding/OnboardingInlineCommandTerminal'
import { FreshnessRow } from './skill-freshness-row'
import {
  consumeSkillFreshnessUpdateDialogRequest,
  subscribeSkillFreshnessUpdateDialog
} from './skill-freshness-update-dialog'

type FreshnessSummaryKind = 'loading' | 'empty' | 'eligible' | 'current' | 'attention'

function summarizeInventory(inventory: SkillFreshnessInventory | null): FreshnessSummaryKind {
  if (!inventory) {
    return 'loading'
  }
  if (inventory.installations.length === 0) {
    return 'empty'
  }
  if (inventory.eligibleUpdateNames.length > 0) {
    return 'eligible'
  }
  // Why: an empty eligible set is either genuine success (everything current) or
  // a blocked/unrecognized placement the safe rail cannot converge; say which.
  return inventory.installations.every((installation) => installation.status === 'current')
    ? 'current'
    : 'attention'
}

function SummaryHeadline({
  kind,
  eligibleCount
}: {
  kind: FreshnessSummaryKind
  eligibleCount: number
}): React.JSX.Element {
  if (kind === 'loading') {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {translate(
          'auto.components.skills.SkillFreshnessUpdateDialog.checking',
          'Checking installed Orca skills…'
        )}
      </div>
    )
  }
  if (kind === 'empty') {
    return (
      <p className="text-xs text-muted-foreground">
        {translate(
          'auto.components.skills.SkillFreshnessUpdateDialog.none',
          'No installed Orca skills found.'
        )}
      </p>
    )
  }
  if (kind === 'current') {
    return (
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
        {translate(
          'auto.components.skills.SkillFreshnessUpdateDialog.success',
          'All installed Orca skills are up to date.'
        )}
      </div>
    )
  }
  if (kind === 'attention') {
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
          {translate(
            'auto.components.skills.SkillFreshnessUpdateDialog.attention',
            'Some installed Orca skills cannot be updated automatically.'
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.skills.SkillFreshnessUpdateDialog.attentionDescription',
            'Open Details to see why a safe global update is not offered for each copy.'
          )}
        </p>
      </div>
    )
  }
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium text-foreground">
        {eligibleCount === 1
          ? translate(
              'auto.components.skills.SkillFreshnessUpdateDialog.updateOne',
              '1 skill can be updated safely'
            )
          : translate(
              'auto.components.skills.SkillFreshnessUpdateDialog.updateMany',
              '{{value0}} skills can be updated safely',
              { value0: eligibleCount }
            )}
      </p>
      <p className="text-xs text-muted-foreground">
        {translate(
          'auto.components.skills.SkillFreshnessUpdateDialog.updateDescription',
          'The command is pre-filled below. Review it, then press Enter yourself to run it.'
        )}
      </p>
    </div>
  )
}

export function SkillFreshnessUpdateDialog(): React.JSX.Element {
  const state = useSkillFreshness()
  const [open, setOpen] = useState(false)
  const [terminalCommand, setTerminalCommand] = useState<string | null>(null)
  const [awaitingExitRefresh, setAwaitingExitRefresh] = useState(false)
  const terminalSubmittedRef = useRef(false)
  const inventoryAtTerminalExitRef = useRef<SkillFreshnessInventory | null>(null)
  const inventory = state.inventory
  const eligibleNames = useMemo(() => inventory?.eligibleUpdateNames ?? [], [inventory])
  const eligibleNameSet = useMemo(() => new Set(eligibleNames), [eligibleNames])
  const updateCommand = buildTargetedSkillUpdateCommand(eligibleNames)
  const summaryKind = summarizeInventory(inventory)

  useEffect(() => {
    const openIfRequested = (): void => {
      if (consumeSkillFreshnessUpdateDialogRequest()) {
        setOpen(true)
      }
    }
    // Why: a request can arrive before this effect runs (dialog mounts after the
    // nudge fires); consume on mount, then subscribe so neither path drops it.
    openIfRequested()
    return subscribeSkillFreshnessUpdateDialog(openIfRequested)
  }, [])

  useEffect(() => {
    if (!open || state.loading || state.error) {
      return
    }
    if (awaitingExitRefresh) {
      if (inventory === inventoryAtTerminalExitRef.current) {
        return
      }
      inventoryAtTerminalExitRef.current = null
      setAwaitingExitRefresh(false)
      return
    }
    if (terminalSubmittedRef.current || terminalCommand === updateCommand) {
      return
    }
    // Why: changing the shared onboarding terminal's command pastes it again.
    // Replace only an unsubmitted draft; a submitted command owns its PTY until exit.
    setTerminalCommand(updateCommand)
  }, [
    awaitingExitRefresh,
    inventory,
    open,
    state.error,
    state.loading,
    terminalCommand,
    updateCommand
  ])

  const handleOpenChange = (next: boolean): void => {
    setOpen(next)
    // Why: closing is the natural point to re-observe bytes so a completed update
    // clears the state and the lingering nudge does not fire again.
    if (!next) {
      terminalSubmittedRef.current = false
      inventoryAtTerminalExitRef.current = null
      setAwaitingExitRefresh(false)
      setTerminalCommand(null)
      notifyInstalledAgentSkillsChanged()
    }
  }

  const handleTerminalInteraction = (
    method: 'keyboard' | 'pointer',
    event?: KeyboardEvent<HTMLElement>
  ): void => {
    if (method === 'keyboard' && event?.key === 'Enter') {
      terminalSubmittedRef.current = true
    }
  }

  const handleTerminalExit = (): void => {
    terminalSubmittedRef.current = false
    inventoryAtTerminalExitRef.current = inventory
    setAwaitingExitRefresh(true)
    setTerminalCommand(null)
    notifyInstalledAgentSkillsChanged()
  }

  const hasInstallations = Boolean(inventory && inventory.installations.length > 0)

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="scrollbar-sleek max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {translate(
              'auto.components.skills.SkillFreshnessUpdateDialog.title',
              'Orca skill freshness'
            )}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.skills.SkillFreshnessUpdateDialog.description',
              'Orca compares installed copies with official snapshots. It never writes to skill folders or runs update commands automatically.'
            )}
          </DialogDescription>
        </DialogHeader>

        {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}

        <SummaryHeadline kind={summaryKind} eligibleCount={eligibleNames.length} />

        {terminalCommand ? (
          <OnboardingInlineCommandTerminal
            key={terminalCommand}
            command={terminalCommand}
            title={translate(
              'auto.components.skills.SkillFreshnessUpdateDialog.terminalTitle',
              'Update Orca skills'
            )}
            description={translate(
              'auto.components.skills.SkillFreshnessUpdateDialog.terminalDescription',
              'The targeted command is pre-filled but not running. Review it and press Enter to continue.'
            )}
            ariaLabel={translate(
              'auto.components.skills.SkillFreshnessUpdateDialog.terminalAria',
              'Orca skill update terminal'
            )}
            worktreeId="skill-freshness-update-terminal"
            terminalHeightPx={200}
            terminalTopMarginPx={0}
            autoScrollIntoView={false}
            onInteracted={handleTerminalInteraction}
            onTerminalExit={handleTerminalExit}
          />
        ) : null}

        {hasInstallations ? (
          <Collapsible defaultOpen={summaryKind === 'attention'}>
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="group -ml-2 gap-1.5 text-muted-foreground"
              >
                <ChevronDown className="size-3.5 transition-transform group-data-[state=open]:rotate-180" />
                {translate('auto.components.skills.SkillFreshnessUpdateDialog.details', 'Details')}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-1 divide-y divide-border/40 rounded-md border border-border/60 px-3">
              {inventory?.installations.map((installation) => (
                <FreshnessRow
                  key={installation.id}
                  installation={installation}
                  eligibleNames={eligibleNameSet}
                />
              ))}
            </CollapsibleContent>
          </Collapsible>
        ) : null}

        <DialogFooter className="sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={state.loading}
            onClick={() => void state.refresh()}
          >
            <RefreshCw className={state.loading ? 'animate-spin' : undefined} />
            {translate('auto.components.skills.SkillFreshnessUpdateDialog.checkNow', 'Check now')}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => handleOpenChange(false)}>
            {translate('auto.components.skills.SkillFreshnessUpdateDialog.close', 'Close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ExternalLink, FolderPlus, GitBranchPlus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../store'
import type { Repo } from '../../../shared/types'
import {
  dismissPreflightIssue,
  githubProjectKeys,
  isPreflightIssueDismissed
} from './landing-preflight-dismissal'
import { ShortcutKeyCombo } from './ShortcutKeyCombo'
import { useShortcutKeyDetails } from '@/hooks/useShortcutLabel'
import { translate } from '@/i18n/i18n'
import {
  getLandingPreflightIssues,
  hasGitHubBackedProject,
  type PreflightIssue
} from './landing-preflight-issues'
import { Button } from './ui/button'

function PreflightBanner({
  issues,
  repos
}: {
  issues: PreflightIssue[]
  repos: Repo[]
}): React.JSX.Element | null {
  // Why: keying the seed on the current GitHub project set means adding a new
  // GitHub project (which changes the key) re-evaluates dismissals, so a lapsed
  // dismissal re-surfaces the nudge without a manual reset.
  const githubKey = githubProjectKeys(repos).join('|')
  const [dismissed, setDismissed] = useState<Set<string>>(
    () =>
      new Set(
        issues
          .filter((issue) => issue.dismissible && isPreflightIssueDismissed(issue.id, repos))
          .map((issue) => issue.id)
      )
  )

  useEffect(() => {
    setDismissed(
      new Set(
        issues
          .filter((issue) => issue.dismissible && isPreflightIssueDismissed(issue.id, repos))
          .map((issue) => issue.id)
      )
    )
    // Why: re-seed only when the GitHub project set changes; issues identity is
    // stable per render and would otherwise reset transient dismiss state.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [githubKey])

  const visibleIssues = issues.filter((issue) => !dismissed.has(issue.id))
  if (visibleIssues.length === 0) {
    return null
  }

  const dismiss = (issue: PreflightIssue): void => {
    dismissPreflightIssue(issue.id, repos)
    setDismissed((prev) => new Set(prev).add(issue.id))
  }

  return (
    // Why: cap width below the max-w-lg column so the card reads as part of the
    // centered content stack instead of stretching edge-to-edge. The styleguide
    // reserves color for true error state — these are soft setup nudges, so use
    // the quiet muted/border surface, not an amber frame.
    <div className="w-full max-w-sm space-y-1.5 rounded-lg border border-border bg-muted/40 p-3">
      {visibleIssues.map((issue) => (
        <div
          key={issue.id}
          className="flex items-start gap-3 rounded-md px-1 py-1.5 first:pt-0 last:pb-0"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500/70" />
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="text-[13px] font-medium leading-snug text-foreground">{issue.title}</p>
            <p className="text-xs leading-snug text-muted-foreground">{issue.description}</p>
            <button
              className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline cursor-pointer"
              onClick={() => window.api.shell.openUrl(issue.fixUrl)}
            >
              {issue.fixLabel}
              <ExternalLink className="size-3" />
            </button>
          </div>
          {issue.dismissible && (
            <button
              className="-mr-1 -mt-0.5 shrink-0 rounded p-1 text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground cursor-pointer"
              onClick={() => dismiss(issue)}
              aria-label={translate('auto.components.Landing.preflightDismiss', 'Dismiss')}
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

export default function Landing(): React.JSX.Element {
  useTranslation()
  const repos = useAppStore((s) => s.repos)
  const openModal = useAppStore((s) => s.openModal)

  const hasGitHubProject = useMemo(() => hasGitHubBackedProject(repos), [repos])

  const [preflightIssues, setPreflightIssues] = useState<PreflightIssue[]>([])

  useEffect(() => {
    let cancelled = false
    const refreshPreflight = (force = false): void => {
      void window.api.preflight.check(force ? { force: true } : undefined).then((status) => {
        if (cancelled) {
          return
        }
        setPreflightIssues(
          getLandingPreflightIssues(status, { hasGitHubBackedProject: hasGitHubProject })
        )
      })
    }

    // oxlint-disable-next-line react-doctor/no-initialize-state -- Why: preflight status is read from an external IPC probe on mount and focus.
    refreshPreflight()

    // Why: users often install/authenticate gh outside Orca. Re-check when the
    // window becomes active again so the landing warning clears without relaunch.
    const handleWindowActive = (): void => {
      if (document.visibilityState === 'visible') {
        refreshPreflight(true)
      }
    }

    document.addEventListener('visibilitychange', handleWindowActive)
    window.addEventListener('focus', handleWindowActive)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', handleWindowActive)
      window.removeEventListener('focus', handleWindowActive)
    }
  }, [hasGitHubProject])

  useEffect(() => {
    if (preflightIssues.length === 0) {
      return
    }

    let cancelled = false
    // Why: some users complete `gh auth login` without ever leaving the Orca
    // window. Poll only while a warning is visible so the banner self-clears.
    const intervalId = window.setInterval(() => {
      void window.api.preflight.check({ force: true }).then((status) => {
        if (cancelled) {
          return
        }
        setPreflightIssues(
          getLandingPreflightIssues(status, { hasGitHubBackedProject: hasGitHubProject })
        )
      })
    }, 30000)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [hasGitHubProject, preflightIssues.length])

  const createWorktreeShortcut = useShortcutKeyDetails('workspace.create')
  const newAgentWorkspaceLabel = translate(
    'auto.components.Landing.76a95f7f47',
    'New agent workspace'
  )

  return (
    <div
      className="absolute inset-0 flex items-center justify-center bg-background"
      data-landing-agent-creation
    >
      <main className="w-full max-w-lg px-6 py-10">
        <section aria-labelledby="landing-agent-creation-title">
          <h1
            id="landing-agent-creation-title"
            className="mb-2 text-[12px] font-medium text-muted-foreground"
          >
            {translate('auto.components.Landing.6ca6ff404e', 'Start an agent')}
          </h1>
          <Button
            type="button"
            variant="outline"
            className="h-14 w-full justify-start gap-3 rounded-md border-border bg-card px-4 text-left shadow-none hover:border-muted-foreground/35 hover:bg-accent/60"
            onClick={() => openModal('new-workspace-composer', { telemetrySource: 'unknown' })}
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-sm border border-border bg-muted text-muted-foreground">
              <GitBranchPlus className="size-3.5" />
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
              {newAgentWorkspaceLabel}
            </span>
            <ShortcutKeyCombo
              keys={createWorktreeShortcut.keys}
              doubleTap={createWorktreeShortcut.doubleTap}
              separatorClassName="mx-0.5 text-[10px] text-muted-foreground"
            />
          </Button>

          <div className="mt-2 flex justify-end">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="text-muted-foreground"
              onClick={() => openModal('add-repo')}
            >
              <FolderPlus className="size-3" />
              {translate('auto.components.Landing.f9eaa9e12d', 'Add project')}
            </Button>
          </div>

          {preflightIssues.length > 0 ? (
            <div className="mt-5">
              <PreflightBanner issues={preflightIssues} repos={repos} />
            </div>
          ) : null}
        </section>
      </main>
    </div>
  )
}

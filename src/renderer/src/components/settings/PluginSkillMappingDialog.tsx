import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { PluginHostListEntry } from '../../../../preload/api-types'
import type {
  PluginSkillContributionMapping,
  PluginSkillProvider,
  PluginSkillStoreSnapshot
} from '../../../../shared/plugins/plugin-skill-store'
import type { Repo } from '../../../../shared/types'
import { areRuntimePathsEqual } from '../../../../shared/worktree-ownership'
import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'

type PluginSkillMappingDialogProps = {
  plugin: PluginHostListEntry | null
  onClose: () => void
}

type ProviderChoice = 'disabled' | 'user' | `repo:${string}`

function choiceKey(contributionPath: string, provider: PluginSkillProvider): string {
  return `${contributionPath}\0${provider}`
}

function providerLabel(provider: PluginSkillProvider): string {
  if (provider === 'codex') {
    return 'Codex'
  }
  if (provider === 'claude') {
    return 'Claude'
  }
  return translate(
    'auto.components.settings.PluginSkillMappingDialog.agentSkillsProvider',
    'Shared agent skills'
  )
}

function initialChoice(
  mapping: PluginSkillContributionMapping | undefined,
  provider: PluginSkillProvider,
  repos: readonly Repo[]
): ProviderChoice {
  if (!mapping) {
    return 'user'
  }
  const target = mapping.targets.find((candidate) => candidate.providers.includes(provider))
  if (!target) {
    return 'disabled'
  }
  if (target.scope === 'user') {
    return 'user'
  }
  const repo = repos.find((candidate) =>
    areRuntimePathsEqual(candidate.path, target.repositoryPath!)
  )
  return repo ? `repo:${repo.id}` : 'disabled'
}

export function PluginSkillMappingDialog({
  plugin,
  onClose
}: PluginSkillMappingDialogProps): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<PluginSkillStoreSnapshot | null>(null)
  const [repos, setRepos] = useState<Repo[]>([])
  const [choices, setChoices] = useState<Record<string, ProviderChoice>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const contributions = useMemo(() => {
    if (!plugin || !snapshot) {
      return []
    }
    const grouped = new Map<string, Set<PluginSkillProvider>>()
    for (const registration of snapshot.registrations) {
      if (registration.pluginKey !== plugin.pluginKey) {
        continue
      }
      const providers = grouped.get(registration.contributionPath) ?? new Set()
      registration.providers.forEach((provider) => providers.add(provider))
      grouped.set(registration.contributionPath, providers)
    }
    return [...grouped].map(([path, providers]) => ({ path, providers: [...providers] }))
  }, [plugin, snapshot])

  useEffect(() => {
    if (!plugin) {
      setSnapshot(null)
      setRepos([])
      setChoices({})
      setError(null)
      return
    }
    let cancelled = false
    setBusy(true)
    void Promise.all([window.api.plugins.listSkillStore(), window.api.repos.list()])
      .then(([nextSnapshot, allRepos]) => {
        if (cancelled) {
          return
        }
        const localRepos = allRepos.filter((repo) => !repo.connectionId)
        const nextChoices: Record<string, ProviderChoice> = {}
        const registrations = nextSnapshot.registrations.filter(
          (registration) => registration.pluginKey === plugin.pluginKey
        )
        for (const registration of registrations) {
          const mapping = nextSnapshot.mappings.find(
            (candidate) =>
              candidate.pluginKey === plugin.pluginKey &&
              candidate.contributionPath === registration.contributionPath
          )
          for (const provider of registration.providers) {
            nextChoices[choiceKey(registration.contributionPath, provider)] = initialChoice(
              mapping,
              provider,
              localRepos
            )
          }
        }
        setSnapshot(nextSnapshot)
        setRepos(localRepos)
        setChoices(nextChoices)
        setError(null)
      })
      .catch((cause: unknown) => {
        console.warn('[plugins] failed to load skill mappings:', cause)
        if (!cancelled) {
          setError(
            translate(
              'auto.components.settings.PluginSkillMappingDialog.loadFailed',
              'Could not load skill installation settings.'
            )
          )
        }
      })
      .finally(() => !cancelled && setBusy(false))
    return () => {
      cancelled = true
    }
  }, [plugin])

  const save = async (): Promise<void> => {
    if (!plugin) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      for (const contribution of contributions) {
        const userProviders: PluginSkillProvider[] = []
        const repoProviders = new Map<string, PluginSkillProvider[]>()
        for (const provider of contribution.providers) {
          const choice = choices[choiceKey(contribution.path, provider)] ?? 'disabled'
          if (choice === 'user') {
            userProviders.push(provider)
          } else if (choice.startsWith('repo:')) {
            const repoId = choice.slice('repo:'.length)
            const providers = repoProviders.get(repoId) ?? []
            providers.push(provider)
            repoProviders.set(repoId, providers)
          }
        }
        const targets: PluginSkillContributionMapping['targets'] = []
        if (userProviders.length > 0) {
          targets.push({ scope: 'user', providers: userProviders })
        }
        for (const [repoId, providers] of repoProviders) {
          const repositoryPath = repos.find((repo) => repo.id === repoId)?.path
          if (repositoryPath) {
            targets.push({ scope: 'repository', repositoryPath, providers })
          }
        }
        await window.api.plugins.setSkillMapping({
          pluginKey: plugin.pluginKey,
          contributionPath: contribution.path,
          targets
        })
      }
      onClose()
    } catch (cause) {
      console.warn('[plugins] failed to save skill mappings:', cause)
      setError(
        translate(
          'auto.components.settings.PluginSkillMappingDialog.saveFailed',
          'Could not update skill installation settings.'
        )
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={Boolean(plugin)} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {translate(
              'auto.components.settings.PluginSkillMappingDialog.title',
              'Choose where skills are installed'
            )}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.settings.PluginSkillMappingDialog.description',
              'User skills are available across projects. Repository skills are copied only into a registered local project; SSH synchronization arrives in a later phase.'
            )}
          </DialogDescription>
        </DialogHeader>
        {busy && !snapshot ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="animate-spin" />
            {translate(
              'auto.components.settings.PluginSkillMappingDialog.loading',
              'Loading skill settings…'
            )}
          </div>
        ) : contributions.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            {translate(
              'auto.components.settings.PluginSkillMappingDialog.noSkills',
              'Enable this plugin before configuring its skills.'
            )}
          </p>
        ) : (
          <div className="max-h-80 space-y-4 overflow-y-auto pr-1 scrollbar-sleek">
            {contributions.map((contribution) => (
              <div key={contribution.path} className="rounded-md border border-border p-3">
                <p className="mb-2 truncate font-mono text-xs text-muted-foreground">
                  {contribution.path}
                </p>
                <div className="space-y-2">
                  {contribution.providers.map((provider) => (
                    <label
                      key={provider}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span>{providerLabel(provider)}</span>
                      <Select
                        value={choices[choiceKey(contribution.path, provider)] ?? 'disabled'}
                        disabled={busy}
                        onValueChange={(value: ProviderChoice) =>
                          setChoices((current) => ({
                            ...current,
                            [choiceKey(contribution.path, provider)]: value
                          }))
                        }
                      >
                        <SelectTrigger size="sm" className="w-56">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="user">
                            {translate(
                              'auto.components.settings.PluginSkillMappingDialog.userScope',
                              'User profile'
                            )}
                          </SelectItem>
                          <SelectItem value="disabled">
                            {translate(
                              'auto.components.settings.PluginSkillMappingDialog.disabled',
                              'Do not install'
                            )}
                          </SelectItem>
                          {repos.map((repo) => (
                            <SelectItem key={repo.id} value={`repo:${repo.id}`}>
                              {repo.displayName || repo.path}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            {translate('auto.components.settings.PluginSkillMappingDialog.cancel', 'Cancel')}
          </Button>
          <Button disabled={busy || contributions.length === 0} onClick={() => void save()}>
            {busy ? <Loader2 className="animate-spin" /> : null}
            {translate('auto.components.settings.PluginSkillMappingDialog.save', 'Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

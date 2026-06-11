import { useState } from 'react'
import { getExecutionHostLabel } from '../../../../shared/execution-host'
import {
  LOCAL_EXECUTION_HOST_ID,
  toRuntimeExecutionHostId,
  toSshExecutionHostId,
  type ExecutionHostId
} from '../../../../shared/execution-host'
import type { ProjectHostSetup, ProjectHostSetupState, Repo } from '../../../../shared/types'
import { useAppStore } from '../../store'
import { getProjectHostSetupProjectionFromState } from '../../store/selectors'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { SearchableSetting } from './SearchableSetting'
import { SettingsBadge } from './SettingsFormControls'
import { matchesSettingsSearch } from './settings-search'
import type { SettingsSearchEntry } from './settings-search'
import { translate } from '@/i18n/i18n'

type RepositoryHostSetupsSectionProps = {
  repo: Repo
  forceVisible: boolean
  searchQuery: string
  searchEntries: SettingsSearchEntry[]
}

type SetupHostOption = {
  id: ExecutionHostId
  label: string
}

function getSetupStateLabel(setupState: ProjectHostSetupState): string {
  switch (setupState) {
    case 'ready':
      return translate('auto.components.settings.RepositoryPane.hostSetupStateReady', 'Ready')
    case 'not-set-up':
      return translate(
        'auto.components.settings.RepositoryPane.hostSetupStateNotSetUp',
        'Not set up'
      )
    case 'setting-up':
      return translate(
        'auto.components.settings.RepositoryPane.hostSetupStateSettingUp',
        'Setting up'
      )
    case 'error':
      return translate('auto.components.settings.RepositoryPane.hostSetupStateError', 'Error')
    case 'unsupported':
      return translate(
        'auto.components.settings.RepositoryPane.hostSetupStateUnsupported',
        'Unsupported'
      )
  }
}

function buildSetupHostOptions({
  projectHostSetups,
  sshTargetLabels,
  activeRuntimeEnvironmentId
}: {
  projectHostSetups: ProjectHostSetup[]
  sshTargetLabels: Map<string, string>
  activeRuntimeEnvironmentId: string | null | undefined
}): SetupHostOption[] {
  const setupHostIds = new Set(projectHostSetups.map((setup) => setup.hostId))
  const options: SetupHostOption[] = []
  if (!setupHostIds.has(LOCAL_EXECUTION_HOST_ID)) {
    options.push({
      id: LOCAL_EXECUTION_HOST_ID,
      label: getExecutionHostLabel(LOCAL_EXECUTION_HOST_ID)
    })
  }
  for (const [targetId, label] of sshTargetLabels) {
    const id = toSshExecutionHostId(targetId)
    if (!setupHostIds.has(id)) {
      options.push({ id, label })
    }
  }
  const runtimeEnvironmentId = activeRuntimeEnvironmentId?.trim()
  if (runtimeEnvironmentId) {
    const id = toRuntimeExecutionHostId(runtimeEnvironmentId)
    if (!setupHostIds.has(id)) {
      options.push({ id, label: runtimeEnvironmentId })
    }
  }
  return options
}

export function RepositoryHostSetupsSection({
  repo,
  forceVisible,
  searchQuery,
  searchEntries
}: RepositoryHostSetupsSectionProps): React.JSX.Element | null {
  const openSettingsPage = useAppStore((state) => state.openSettingsPage)
  const openSettingsTarget = useAppStore((state) => state.openSettingsTarget)
  const setupProjectExistingFolder = useAppStore((state) => state.setupProjectExistingFolder)
  const createProjectHostSetup = useAppStore((state) => state.createProjectHostSetup)
  const deleteProjectHostSetup = useAppStore((state) => state.deleteProjectHostSetup)
  const sshTargetLabels = useAppStore((state) => state.sshTargetLabels)
  const activeRuntimeEnvironmentId = useAppStore(
    (state) => state.settings?.activeRuntimeEnvironmentId
  )
  const projectHostSetupProjection = useAppStore((state) =>
    getProjectHostSetupProjectionFromState(state)
  )
  const selectedProjectHostSetup = projectHostSetupProjection.setups.find(
    (setup) => setup.repoId === repo.id
  )
  const projectHostSetups = selectedProjectHostSetup
    ? projectHostSetupProjection.setups.filter(
        (setup) => setup.projectId === selectedProjectHostSetup.projectId
      )
    : []
  const setupHostOptions = buildSetupHostOptions({
    projectHostSetups,
    sshTargetLabels,
    activeRuntimeEnvironmentId
  })
  const [selectedSetupHostId, setSelectedSetupHostId] = useState<ExecutionHostId | null>(null)
  const [setupPath, setSetupPath] = useState('')
  const [setupKind, setSetupKind] = useState<'git' | 'folder'>('git')
  const [isSettingUp, setIsSettingUp] = useState(false)
  const [isCreatingPendingSetup, setIsCreatingPendingSetup] = useState(false)
  const [deletingSetupId, setDeletingSetupId] = useState<string | null>(null)
  const setupTargetHostId = selectedSetupHostId ?? setupHostOptions[0]?.id ?? null

  if (
    (projectHostSetups.length <= 1 && setupHostOptions.length === 0) ||
    (!forceVisible && !matchesSettingsSearch(searchQuery, searchEntries))
  ) {
    return null
  }

  return (
    <SearchableSetting
      title={translate('auto.components.settings.RepositoryPane.availableHosts', 'Available Hosts')}
      description={translate(
        'auto.components.settings.RepositoryPane.availableHostsDescription',
        'Hosts where this project is set up.'
      )}
      keywords={[repo.displayName, 'host', 'ssh', 'remote', 'vm', 'path']}
      className="space-y-3"
      forceVisible={forceVisible}
    >
      <div className="space-y-1">
        <Label className="text-sm font-semibold">
          {translate('auto.components.settings.RepositoryPane.availableHosts', 'Available Hosts')}
        </Label>
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.settings.RepositoryPane.availableHostsHelp',
            'Project paths and worktree settings are host-specific; creating a workspace can target any ready setup.'
          )}
        </p>
      </div>
      <div className="divide-y divide-border rounded-md border border-border">
        {projectHostSetups.map((setup) => {
          const isCurrentSetup = setup.repoId === repo.id
          const canOpenSetup = setup.repoId.trim().length > 0
          const canRemoveSetup = !canOpenSetup && deletingSetupId !== setup.id
          return (
            <div
              key={setup.id}
              className={cn(
                'flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors',
                isCurrentSetup ? 'bg-muted/30' : ''
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-medium">
                    {getExecutionHostLabel(setup.hostId)}
                  </span>
                  <SettingsBadge tone={setup.setupState === 'ready' ? 'accent' : 'muted'}>
                    {getSetupStateLabel(setup.setupState)}
                  </SettingsBadge>
                </div>
                <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                  {setup.path ||
                    translate(
                      'auto.components.settings.RepositoryPane.setupPathPending',
                      'Path pending'
                    )}
                </p>
              </div>
              {isCurrentSetup ? (
                <SettingsBadge>
                  {translate('auto.components.settings.RepositoryPane.currentSetup', 'Current')}
                </SettingsBadge>
              ) : null}
              {!isCurrentSetup && canOpenSetup ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    openSettingsPage()
                    openSettingsTarget({ pane: 'repo', repoId: setup.repoId })
                  }}
                >
                  {translate('auto.components.settings.RepositoryPane.openSetup', 'Open')}
                </Button>
              ) : null}
              {canRemoveSetup ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    setDeletingSetupId(setup.id)
                    await deleteProjectHostSetup({ setupId: setup.id })
                    setDeletingSetupId(null)
                  }}
                >
                  {translate('auto.components.settings.RepositoryPane.removeSetup', 'Remove')}
                </Button>
              ) : null}
            </div>
          )
        })}
      </div>
      {selectedProjectHostSetup && setupHostOptions.length > 0 ? (
        <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3">
          <div className="space-y-1">
            <Label className="text-sm font-semibold">
              {translate(
                'auto.components.settings.RepositoryPane.setupExistingFolder',
                'Import existing folder'
              )}
            </Label>
            <p className="text-xs text-muted-foreground">
              {translate(
                'auto.components.settings.RepositoryPane.setupExistingFolderHelp',
                'Make this project available on another host by linking a checkout that already exists there.'
              )}
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
            <Select
              value={setupTargetHostId ?? undefined}
              onValueChange={(value) => setSelectedSetupHostId(value as ExecutionHostId)}
            >
              <SelectTrigger className="h-9 min-w-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {setupHostOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={setupPath}
              onChange={(event) => setSetupPath(event.target.value)}
              placeholder={translate(
                'auto.components.settings.RepositoryPane.setupExistingFolderPathPlaceholder',
                '/path/to/project/on/host'
              )}
              className="h-9 min-w-0"
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Select
              value={setupKind}
              onValueChange={(value) => setSetupKind(value as 'git' | 'folder')}
            >
              <SelectTrigger className="h-8 w-32 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="git">
                  {translate('auto.components.settings.RepositoryPane.setupKindGit', 'Git repo')}
                </SelectItem>
                <SelectItem value="folder">
                  {translate('auto.components.settings.RepositoryPane.setupKindFolder', 'Folder')}
                </SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="sm"
              disabled={!setupTargetHostId || !setupPath.trim() || isSettingUp}
              onClick={async () => {
                if (!setupTargetHostId || !selectedProjectHostSetup || !setupPath.trim()) {
                  return
                }
                setIsSettingUp(true)
                const result = await setupProjectExistingFolder({
                  projectId: selectedProjectHostSetup.projectId,
                  hostId: setupTargetHostId,
                  path: setupPath.trim(),
                  kind: setupKind,
                  displayName: repo.displayName
                })
                setIsSettingUp(false)
                if (result) {
                  setSetupPath('')
                  setSelectedSetupHostId(null)
                  openSettingsPage()
                  openSettingsTarget({ pane: 'repo', repoId: result.repo.id })
                }
              }}
            >
              {isSettingUp
                ? translate('auto.components.settings.RepositoryPane.settingUpHost', 'Importing...')
                : translate('auto.components.settings.RepositoryPane.setupHost', 'Import')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!setupTargetHostId || isCreatingPendingSetup}
              onClick={async () => {
                if (!setupTargetHostId || !selectedProjectHostSetup) {
                  return
                }
                setIsCreatingPendingSetup(true)
                const result = await createProjectHostSetup({
                  projectId: selectedProjectHostSetup.projectId,
                  hostId: setupTargetHostId,
                  displayName: repo.displayName,
                  setupState: 'not-set-up',
                  setupMethod: 'provisioned'
                })
                setIsCreatingPendingSetup(false)
                if (result) {
                  setSelectedSetupHostId(null)
                }
              }}
            >
              {isCreatingPendingSetup
                ? translate(
                    'auto.components.settings.RepositoryPane.creatingPendingSetup',
                    'Creating...'
                  )
                : translate(
                    'auto.components.settings.RepositoryPane.createPendingSetup',
                    'Track setup'
                  )}
            </Button>
          </div>
        </div>
      ) : null}
    </SearchableSetting>
  )
}

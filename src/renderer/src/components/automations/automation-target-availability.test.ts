import { describe, expect, it } from 'vitest'
import type { Automation } from '../../../../shared/automations-types'
import type { ProjectHostSetup, Repo, Worktree } from '../../../../shared/types'
import { getAutomationTargetAvailability } from './automation-target-availability'

function makeAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: 'automation-1',
    name: 'Nightly',
    prompt: 'Run checks',
    precheck: null,
    agentId: 'codex',
    projectId: 'repo-1',
    executionTargetType: 'local',
    executionTargetId: 'local',
    schedulerOwner: 'local_host_service',
    workspaceMode: 'existing',
    workspaceId: 'worktree-1',
    baseBranch: null,
    reuseSession: false,
    timezone: 'America/Los_Angeles',
    rrule: 'FREQ=DAILY',
    dtstart: 1,
    enabled: true,
    nextRunAt: 2,
    missedRunPolicy: 'run_once_within_grace',
    missedRunGraceMinutes: 720,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

function makeRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 'repo-1',
    path: '/repo',
    displayName: 'Repo',
    badgeColor: 'blue',
    addedAt: 1,
    kind: 'git',
    ...overrides
  }
}

function makeWorkspace(overrides: Partial<Worktree> = {}): Worktree {
  return {
    id: 'worktree-1',
    repoId: 'repo-1',
    path: '/repo',
    displayName: 'Main',
    ...overrides
  } as Worktree
}

function makeProjectHostSetup(overrides: Partial<ProjectHostSetup> = {}): ProjectHostSetup {
  return {
    id: 'setup-1',
    projectId: 'project-1',
    hostId: 'local',
    repoId: 'repo-1',
    path: '/repo',
    displayName: 'Repo',
    setupState: 'ready',
    setupMethod: 'legacy-repo',
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

describe('automation target availability', () => {
  it('allows local automations with an available existing workspace', () => {
    expect(
      getAutomationTargetAvailability({
        automation: makeAutomation(),
        repo: makeRepo(),
        workspace: makeWorkspace(),
        projectHostSetups: [],
        sshConnectionStates: new Map()
      })
    ).toEqual({ canRunNow: true, reason: 'available', message: null })
  })

  it('blocks missing projects and missing existing workspaces', () => {
    expect(
      getAutomationTargetAvailability({
        automation: makeAutomation(),
        repo: null,
        workspace: makeWorkspace(),
        projectHostSetups: [],
        sshConnectionStates: new Map()
      }).reason
    ).toBe('missing-project')

    expect(
      getAutomationTargetAvailability({
        automation: makeAutomation(),
        repo: makeRepo(),
        workspace: null,
        projectHostSetups: [],
        sshConnectionStates: new Map()
      }).reason
    ).toBe('missing-workspace')
  })

  it('blocks a saved run context that no longer matches the repo host setup', () => {
    expect(
      getAutomationTargetAvailability({
        automation: makeAutomation({
          runContext: {
            kind: 'workspace-run',
            projectId: 'project-1',
            hostId: 'ssh:devbox',
            projectHostSetupId: 'setup-1',
            repoId: 'repo-1',
            path: '/repo'
          }
        }),
        repo: makeRepo(),
        workspace: makeWorkspace(),
        projectHostSetups: [makeProjectHostSetup()],
        sshConnectionStates: new Map()
      }).reason
    ).toBe('host-mismatch')
  })

  it('blocks saved run contexts whose project host setup is missing or not ready', () => {
    const automation = makeAutomation({
      runContext: {
        kind: 'workspace-run',
        projectId: 'project-1',
        hostId: 'local',
        projectHostSetupId: 'setup-1',
        repoId: 'repo-1',
        path: '/repo'
      }
    })

    expect(
      getAutomationTargetAvailability({
        automation,
        repo: makeRepo(),
        workspace: makeWorkspace(),
        projectHostSetups: [],
        sshConnectionStates: new Map()
      }).reason
    ).toBe('missing-project-host-setup')

    expect(
      getAutomationTargetAvailability({
        automation,
        repo: makeRepo(),
        workspace: makeWorkspace(),
        projectHostSetups: [makeProjectHostSetup({ setupState: 'error' })],
        sshConnectionStates: new Map()
      })
    ).toMatchObject({
      reason: 'project-host-setup-not-ready',
      message: 'Project setup on the selected automation host is error.'
    })
  })

  it('requires SSH hosts to be connected before manual runs', () => {
    const automation = makeAutomation({
      executionTargetType: 'ssh',
      executionTargetId: 'devbox',
      runContext: {
        kind: 'workspace-run',
        projectId: 'project-1',
        hostId: 'ssh:devbox',
        projectHostSetupId: 'setup-1',
        repoId: 'repo-1',
        path: '/repo'
      }
    })
    const repo = makeRepo({ connectionId: 'devbox', executionHostId: 'ssh:devbox' })

    expect(
      getAutomationTargetAvailability({
        automation,
        repo,
        workspace: makeWorkspace(),
        projectHostSetups: [
          makeProjectHostSetup({
            hostId: 'ssh:devbox',
            connectionId: 'devbox',
            executionHostId: 'ssh:devbox'
          })
        ],
        sshConnectionStates: new Map([['devbox', { status: 'connected' }]])
      }).canRunNow
    ).toBe(true)

    expect(
      getAutomationTargetAvailability({
        automation,
        repo,
        workspace: makeWorkspace(),
        projectHostSetups: [
          makeProjectHostSetup({
            hostId: 'ssh:devbox',
            connectionId: 'devbox',
            executionHostId: 'ssh:devbox'
          })
        ],
        sshConnectionStates: new Map([['devbox', { status: 'disconnected' }]])
      }).reason
    ).toBe('ssh-unavailable')

    expect(
      getAutomationTargetAvailability({
        automation,
        repo,
        workspace: makeWorkspace(),
        projectHostSetups: [
          makeProjectHostSetup({
            hostId: 'ssh:devbox',
            connectionId: 'devbox',
            executionHostId: 'ssh:devbox'
          })
        ],
        sshConnectionStates: new Map([['devbox', { status: 'auth-failed' }]])
      }).reason
    ).toBe('ssh-auth-needed')

    expect(
      getAutomationTargetAvailability({
        automation,
        repo,
        workspace: makeWorkspace(),
        projectHostSetups: [
          makeProjectHostSetup({
            hostId: 'ssh:devbox',
            connectionId: 'devbox',
            executionHostId: 'ssh:devbox'
          })
        ],
        sshConnectionStates: new Map([['devbox', { status: 'reconnecting' }]])
      }).reason
    ).toBe('ssh-connecting')
  })
})

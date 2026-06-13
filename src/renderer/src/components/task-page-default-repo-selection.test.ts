import { describe, expect, it } from 'vitest'
import type { Repo } from '../../../shared/types'
import {
  getDefaultTaskRepoSelection,
  getTaskProjectPickerRepos,
  normalizeTaskRepoSelection
} from './task-page-default-repo-selection'

function repo(overrides: Partial<Repo> & Pick<Repo, 'id'>): Repo {
  return {
    path: `/repos/${overrides.id}`,
    displayName: overrides.id,
    badgeColor: '#737373',
    addedAt: 100,
    kind: 'git',
    ...overrides
  }
}

describe('getDefaultTaskRepoSelection', () => {
  it('selects one source per logical GitHub project', () => {
    const selection = getDefaultTaskRepoSelection([
      repo({
        id: 'local-orca',
        upstream: { owner: 'StablyAI', repo: 'Orca' }
      }),
      repo({
        id: 'ssh-orca',
        connectionId: 'builder',
        upstream: { owner: 'stablyai', repo: 'orca' }
      }),
      repo({
        id: 'other',
        upstream: { owner: 'stablyai', repo: 'other' }
      })
    ])

    expect([...selection].sort()).toEqual(['local-orca', 'other'])
  })

  it('prefers local checkout over a remote checkout for the same project', () => {
    const selection = getDefaultTaskRepoSelection([
      repo({
        id: 'ssh-orca',
        addedAt: 1,
        connectionId: 'builder',
        upstream: { owner: 'stablyai', repo: 'orca' }
      }),
      repo({
        id: 'local-orca',
        addedAt: 2,
        upstream: { owner: 'stablyai', repo: 'orca' }
      })
    ])

    expect([...selection]).toEqual(['local-orca'])
  })

  it('keeps same-named folders separate when provider identity is missing', () => {
    const selection = getDefaultTaskRepoSelection([
      repo({ id: 'local-app', displayName: 'app' }),
      repo({ id: 'ssh-app', displayName: 'app', connectionId: 'builder' })
    ])

    expect([...selection].sort()).toEqual(['local-app', 'ssh-app'])
  })
})

describe('getTaskProjectPickerRepos', () => {
  it('shows one picker row per logical GitHub project', () => {
    const pickerRepos = getTaskProjectPickerRepos([
      repo({
        id: 'local-orca',
        upstream: { owner: 'StablyAI', repo: 'Orca' }
      }),
      repo({
        id: 'ssh-orca',
        connectionId: 'builder',
        upstream: { owner: 'stablyai', repo: 'orca' }
      }),
      repo({
        id: 'other',
        upstream: { owner: 'stablyai', repo: 'other' }
      })
    ])

    expect(pickerRepos.map((candidate) => candidate.id)).toEqual(['local-orca', 'other'])
  })

  it('uses an explicitly selected remote source as the visible project row', () => {
    const pickerRepos = getTaskProjectPickerRepos(
      [
        repo({
          id: 'local-orca',
          upstream: { owner: 'stablyai', repo: 'orca' }
        }),
        repo({
          id: 'ssh-orca',
          connectionId: 'builder',
          upstream: { owner: 'stablyai', repo: 'orca' }
        })
      ],
      new Set(['ssh-orca'])
    )

    expect(pickerRepos.map((candidate) => candidate.id)).toEqual(['ssh-orca'])
  })
})

describe('normalizeTaskRepoSelection', () => {
  it('collapses duplicate selected sources for the same logical project', () => {
    const selection = normalizeTaskRepoSelection(
      [
        repo({
          id: 'local-orca',
          upstream: { owner: 'stablyai', repo: 'orca' }
        }),
        repo({
          id: 'ssh-orca',
          connectionId: 'builder',
          upstream: { owner: 'stablyai', repo: 'orca' }
        })
      ],
      new Set(['local-orca', 'ssh-orca'])
    )

    expect([...selection]).toEqual(['local-orca'])
  })

  it('preserves a single explicit remote source selection', () => {
    const selection = normalizeTaskRepoSelection(
      [
        repo({
          id: 'local-orca',
          upstream: { owner: 'stablyai', repo: 'orca' }
        }),
        repo({
          id: 'ssh-orca',
          connectionId: 'builder',
          upstream: { owner: 'stablyai', repo: 'orca' }
        })
      ],
      new Set(['ssh-orca'])
    )

    expect([...selection]).toEqual(['ssh-orca'])
  })

  it('normalizes raw all-host selection to one source per logical project', () => {
    const selection = normalizeTaskRepoSelection(
      [
        repo({
          id: 'local-orca',
          upstream: { owner: 'stablyai', repo: 'orca' }
        }),
        repo({
          id: 'ssh-orca',
          connectionId: 'builder',
          upstream: { owner: 'stablyai', repo: 'orca' }
        }),
        repo({
          id: 'docs',
          upstream: { owner: 'stablyai', repo: 'docs' }
        })
      ],
      new Set(['local-orca', 'ssh-orca', 'docs'])
    )

    expect([...selection].sort()).toEqual(['docs', 'local-orca'])
  })
})

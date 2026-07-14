import { describe, expect, it } from 'vitest'
import {
  buildTargetedSkillUpdateCommand,
  type SkillFreshnessInstallation
} from '../../shared/skill-freshness'
import { eligibleSkillUpdateNames } from './skill-freshness-eligibility'

function placement(
  name: string,
  overrides: Partial<SkillFreshnessInstallation> = {}
): SkillFreshnessInstallation {
  return {
    id: `${name}-${overrides.rootId ?? 'home-agents'}`,
    name,
    description: null,
    rootId: 'home-agents',
    providers: ['agent-skills'],
    sourceKind: 'home',
    sourceLabel: 'Agent skills home',
    unresolvedPath: `/home/.agents/skills/${name}`,
    resolvedPath: `/home/.agents/skills/${name}`,
    physicalIdentity: `physical-${name}`,
    topology: 'canonical-copy',
    status: 'outdated',
    installedReleaseRevision: 1,
    installedAppVersion: '1.0.0',
    currentReleaseRevision: 2,
    currentPackageDigest: 'current',
    currentAppVersion: '2.0.0',
    observedPackageDigest: 'old',
    errorCategory: null,
    ...overrides
  }
}

describe('skill freshness name-scoped update eligibility', () => {
  it('offers a name when at least one supported placement is outdated and all are official', () => {
    expect(
      eligibleSkillUpdateNames([
        placement('orca-cli'),
        placement('orca-cli', {
          id: 'orca-cli-claude',
          rootId: 'home-claude',
          topology: 'provider-alias',
          status: 'current'
        })
      ])
    ).toEqual(['orca-cli'])
  })

  it.each([
    ['newer-known', 'independent-copy'],
    ['unrecognized', 'independent-copy'],
    ['inaccessible', 'broken-link'],
    ['current', 'independent-copy'],
    ['current', 'external-link'],
    ['current', 'read-only'],
    ['current', 'repo-scope'],
    ['current', 'plugin-cache']
  ] as const)('poisons a name for a %s placement in %s topology', (status, topology) => {
    expect(
      eligibleSkillUpdateNames([
        placement('orca-cli'),
        placement('orca-cli', { id: `poison-${status}-${topology}`, status, topology })
      ])
    ).toEqual([])
  })

  it('does not offer an all-current name or let another safe name hide a poisoned one', () => {
    expect(
      eligibleSkillUpdateNames([
        placement('computer-use', { status: 'current' }),
        placement('orchestration'),
        placement('orchestration', {
          id: 'orchestration-project',
          status: 'unrecognized',
          topology: 'repo-scope'
        })
      ])
    ).toEqual([])
  })

  it('builds only an explicit, deterministic global command', () => {
    expect(buildTargetedSkillUpdateCommand(['orchestration', 'orca-cli', 'orca-cli'])).toBe(
      'npx skills update orca-cli orchestration --global'
    )
    expect(buildTargetedSkillUpdateCommand([])).toBeNull()
    expect(buildTargetedSkillUpdateCommand(['orca-cli;echo unsafe'])).toBeNull()
  })
})

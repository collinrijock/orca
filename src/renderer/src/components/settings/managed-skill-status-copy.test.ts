import { describe, expect, it } from 'vitest'
import {
  managedSkillDisplayName,
  managedSkillReplacementChangeCopy,
  managedSkillSummaryCopy
} from './managed-skill-status-copy'

describe('managed skill settings copy', () => {
  it('explains the user decision instead of exposing release diagnostics', () => {
    expect(managedSkillSummaryCopy({ status: 'known-current' })).toBe(
      'This installed copy matches Orca’s current version.'
    )
    expect(managedSkillSummaryCopy({ status: 'modified' })).toBe(
      'This installed copy has local changes. Review them before replacing it.'
    )
  })

  it('turns package identifiers into readable skill names', () => {
    expect(managedSkillDisplayName('computer-use')).toBe('Computer Use')
    expect(managedSkillDisplayName('orca-cli')).toBe('Orca CLI')
  })

  it('localizes replacement change labels', () => {
    expect(
      (['added', 'removed', 'modified'] as const).map(managedSkillReplacementChangeCopy)
    ).toEqual(['Added', 'Removed', 'Modified'])
  })
})

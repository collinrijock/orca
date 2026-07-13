import { describe, expect, it } from 'vitest'
import { managedSkillDiagnosticCopy } from './managed-skill-status-copy'

describe('managed skill diagnostic copy', () => {
  it('does not attribute unknown bytes to the current Orca release', () => {
    expect(
      managedSkillDiagnosticCopy({
        installedReleaseRevision: null,
        installedAppVersion: null,
        installedPackageDigest: 'abcdef0123456789'
      })
    ).toBe('unverified · abcdef01')
  })

  it('shows release provenance only for a mapped snapshot', () => {
    expect(
      managedSkillDiagnosticCopy({
        installedReleaseRevision: 7,
        installedAppVersion: '1.2.3',
        installedPackageDigest: 'abcdef0123456789'
      })
    ).toBe('r7 · Orca 1.2.3 · abcdef01')
  })
})

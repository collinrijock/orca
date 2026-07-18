import { describe, expect, it } from 'vitest'
import { extractRawDaemonOwnership } from '../daemon/daemon-ownership-raw-extractor'

function state(targetRepoId: unknown): Record<string, unknown> {
  return {
    schemaVersion: 1,
    daemonSessionOwnership: {
      schemaVersion: 1,
      claims: [],
      legacyProtectedSessionIds: [],
      bindingProvenanceByPtyId: {},
      projectTransferLineage: [
        {
          operationId: 'operation-a',
          role: 'target-lineage',
          sourceProfileId: 'personal',
          targetProfileId: 'work',
          repoId: 'source-repo',
          targetRepoId,
          createdAt: 1
        }
      ]
    }
  }
}

describe('profile project transfer lineage raw extraction', () => {
  it('accepts the target repo identity needed for a strict crash-recovery snapshot', () => {
    expect(extractRawDaemonOwnership(state('target-repo'))).toEqual({
      status: 'complete',
      ownership: { exactClaims: [], legacyProtectedSessionIds: [] }
    })
  })

  it('fails closed on a malformed target repo identity', () => {
    expect(extractRawDaemonOwnership(state(''))).toEqual({
      status: 'incomplete',
      reason: 'malformed-current-ownership'
    })
  })
})

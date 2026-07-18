import { describe, expect, it } from 'vitest'
import { extractRawDaemonOwnership } from './daemon-ownership-raw-extractor'

const LEAF_A = '11111111-1111-4111-8111-111111111111'
const LEAF_B = '22222222-2222-4222-8222-222222222222'
const REMOTE_ID = 'ssh:target@@pty-remote'

function state(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { schemaVersion: 1, ...overrides }
}

function workspace(args: {
  tabPtyId?: string | null
  layoutPtyIds?: Record<string, string>
  sleeping?: Record<string, unknown>
}): Record<string, unknown> {
  const tab = { id: 'tab-a', ptyId: args.tabPtyId ?? null }
  const leaves = Object.keys(args.layoutPtyIds ?? {})
  return {
    tabsByWorktree: { 'worktree-a': [tab] },
    terminalLayoutsByTabId: {
      'tab-a': {
        root:
          leaves.length === 0
            ? null
            : leaves.length === 1
              ? { type: 'leaf', leafId: leaves[0] }
              : {
                  type: 'split',
                  direction: 'vertical',
                  first: { type: 'leaf', leafId: leaves[0] },
                  second: { type: 'leaf', leafId: leaves[1] }
                },
        ptyIdsByLeafId: args.layoutPtyIds ?? {}
      }
    },
    ...(args.sleeping ? { sleepingAgentSessionsByPaneKey: args.sleeping } : {})
  }
}

function ownership(args: {
  claims?: unknown[]
  provenance?: Record<string, unknown>
  protectedIds?: string[]
}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    claims: args.claims ?? [],
    legacyProtectedSessionIds: args.protectedIds ?? [],
    bindingProvenanceByPtyId: args.provenance ?? {},
    projectTransferLineage: []
  }
}

function paneClaim(
  sessionId: string,
  protocolVersion = 22,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    sessionId,
    ownerKind: 'pane',
    workspaceKey: 'worktree-a',
    ownerId: LEAF_A,
    provider: 'local-daemon',
    protocolVersion,
    ...overrides
  }
}

function sleepingRecord(paneKey: string, overrides: Record<string, unknown> = {}): unknown {
  return {
    paneKey,
    tabId: 'tab-a',
    worktreeId: 'worktree-a',
    providerSession: { key: 'session_id', id: 'provider-conversation-not-a-pty' },
    ...overrides
  }
}

describe('raw historical daemon ownership extraction', () => {
  it('protects bare tab IDs across every protocol and excludes scoped SSH IDs', () => {
    const result = extractRawDaemonOwnership(
      state({ workspaceSession: workspace({ tabPtyId: 'local-pty' }) })
    )
    const remote = extractRawDaemonOwnership(
      state({ workspaceSession: workspace({ tabPtyId: REMOTE_ID }) })
    )

    expect(result).toEqual({
      status: 'complete',
      ownership: { exactClaims: [], legacyProtectedSessionIds: ['local-pty'] }
    })
    expect(remote).toEqual({
      status: 'complete',
      ownership: { exactClaims: [], legacyProtectedSessionIds: [] }
    })
  })

  it('supports layout-only and split bindings without using worktree metadata', () => {
    const layoutOnly = {
      terminalLayoutsByTabId: {
        orphaned: {
          root: {
            type: 'split',
            first: { type: 'leaf', leafId: LEAF_A },
            second: { type: 'leaf', leafId: LEAF_B }
          },
          ptyIdsByLeafId: { [LEAF_A]: 'pty-a', [LEAF_B]: 'pty-b' }
        }
      }
    }
    const result = extractRawDaemonOwnership(state({ workspaceSession: layoutOnly }))

    expect(result).toMatchObject({
      status: 'complete',
      ownership: { legacyProtectedSessionIds: ['pty-a', 'pty-b'] }
    })
  })

  it('marks tab/layout projection disagreement incomplete', () => {
    const result = extractRawDaemonOwnership(
      state({
        workspaceSession: workspace({
          tabPtyId: 'tab-pty',
          layoutPtyIds: { [LEAF_A]: 'layout-pty' }
        })
      })
    )

    expect(result).toMatchObject({ status: 'incomplete', reason: 'malformed-state' })
  })

  it('excludes bare IDs in valid remote host partitions', () => {
    const result = extractRawDaemonOwnership(
      state({
        workspaceSessionsByHostId: {
          'ssh:target': workspace({ tabPtyId: 'bare-relay-id' }),
          'runtime:environment': workspace({ tabPtyId: 'bare-runtime-id' })
        }
      })
    )

    expect(result).toEqual({
      status: 'complete',
      ownership: { exactClaims: [], legacyProtectedSessionIds: [] }
    })
  })

  it.each(['local', 'invalid-host', 'ssh:'])('rejects invalid host partition %s', (hostId) => {
    const result = extractRawDaemonOwnership(state({ workspaceSessionsByHostId: { [hostId]: {} } }))

    expect(result).toMatchObject({ status: 'incomplete', reason: 'malformed-remote-partition' })
  })

  it('rejects a structurally malformed remote host partition', () => {
    const result = extractRawDaemonOwnership(
      state({ workspaceSessionsByHostId: { 'ssh:target': { tabsByWorktree: [] } } })
    )

    expect(result).toMatchObject({ status: 'incomplete', reason: 'malformed-remote-partition' })
  })

  it('classifies migration, alias, Claude sidecar, and SSH rows conservatively', () => {
    const result = extractRawDaemonOwnership(
      state({
        claudeLivePtySessionIds: ['sidecar-local', REMOTE_ID],
        migrationUnsupportedPtyEntries: [
          {
            ptyId: 'migration-local',
            source: 'local',
            reason: 'legacy-numeric-pane-key',
            updatedAt: 1
          },
          {
            ptyId: 'bare-ssh-id',
            source: 'ssh',
            reason: 'legacy-numeric-pane-key',
            updatedAt: 1
          }
        ],
        legacyPaneKeyAliasEntries: [
          {
            ptyId: 'alias-is-not-owner',
            legacyPaneKey: 'tab:1',
            stablePaneKey: 'tab:2',
            updatedAt: 1
          }
        ]
      })
    )

    expect(result).toMatchObject({
      status: 'complete',
      ownership: { legacyProtectedSessionIds: ['sidecar-local', 'migration-local'] }
    })
  })

  it('joins sleeping routes through pane bindings without treating provider IDs as PTYs', () => {
    const paneKey = `tab-a:${LEAF_A}`
    const result = extractRawDaemonOwnership(
      state({
        workspaceSession: workspace({
          tabPtyId: 'physical-pty',
          layoutPtyIds: { [LEAF_A]: 'physical-pty' },
          sleeping: { [paneKey]: sleepingRecord(paneKey) }
        })
      })
    )

    expect(result).toMatchObject({
      status: 'complete',
      ownership: { legacyProtectedSessionIds: ['physical-pty'] }
    })
  })

  it('marks unresolved local sleep routes incomplete but excludes explicit remote routes', () => {
    const paneKey = `tab-a:${LEAF_A}`
    const unresolved = extractRawDaemonOwnership(
      state({
        workspaceSession: workspace({ sleeping: { [paneKey]: sleepingRecord(paneKey) } })
      })
    )
    const remote = extractRawDaemonOwnership(
      state({
        workspaceSession: workspace({
          sleeping: { [paneKey]: sleepingRecord(paneKey, { connectionId: 'target' }) }
        })
      })
    )

    expect(unresolved).toMatchObject({ status: 'incomplete', reason: 'unresolved-sleep-route' })
    expect(remote).toMatchObject({ status: 'complete' })
  })

  it.each([
    { claudeLivePtySessionIds: ['ok', 4] },
    { migrationUnsupportedPtyEntries: [{ ptyId: 'x', source: 'unknown' }] },
    { legacyPaneKeyAliasEntries: [{ ptyId: 'x' }] }
  ])('rejects malformed mixed-validity legacy collections', (overrides) => {
    expect(extractRawDaemonOwnership(state(overrides))).toMatchObject({ status: 'incomplete' })
  })

  it('rejects unknown ID-bearing fields and malformed scoped SSH IDs', () => {
    expect(extractRawDaemonOwnership(state({ mysteryPtyIds: ['hidden'] }))).toMatchObject({
      status: 'incomplete',
      reason: 'unsupported-ownership-field'
    })
    expect(
      extractRawDaemonOwnership(
        state({ workspaceSession: workspace({ tabPtyId: 'ssh:missing-separator' }) })
      )
    ).toMatchObject({ status: 'incomplete' })
  })

  it.each([
    {
      tabsByWorktree: {
        'worktree-a': [{ id: 'tab-a', ptyId: null, replacementPtyId: 'hidden-tab-owner' }]
      }
    },
    {
      terminalLayoutsByTabId: {
        'tab-a': { root: null, ptyIdsByLeafId: {}, restoredSessionId: 'hidden-layout-owner' }
      }
    },
    {
      tabsByWorktree: { 'worktree-a': [{ id: 'tab-a', ptyId: null }] },
      sleepingAgentSessionsByPaneKey: {
        [`tab-a:${LEAF_A}`]: {
          ...(sleepingRecord(`tab-a:${LEAF_A}`) as Record<string, unknown>),
          recoveryPtyId: 'hidden-sleep-owner'
        }
      }
    },
    {
      terminalLayoutsByTabId: {
        'tab-a': {
          root: { type: 'leaf', leafId: LEAF_A, terminalSessionId: 'hidden-node-owner' },
          ptyIdsByLeafId: {}
        }
      }
    }
  ])('rejects nested additive ownership-like fields in schema v1', (workspaceSession) => {
    expect(extractRawDaemonOwnership(state({ workspaceSession }))).toMatchObject({
      status: 'incomplete'
    })
  })
})

describe('raw current-schema daemon ownership extraction', () => {
  it('emits an exact claim only when pane binding, provenance, and owner agree', () => {
    const result = extractRawDaemonOwnership(
      state({
        workspaceSession: workspace({
          tabPtyId: 'exact-pty',
          layoutPtyIds: { [LEAF_A]: 'exact-pty' }
        }),
        daemonSessionOwnership: ownership({
          claims: [paneClaim('exact-pty')],
          provenance: { 'exact-pty': { kind: 'local-daemon', protocolVersion: 22 } }
        })
      })
    )

    expect(result).toEqual({
      status: 'complete',
      ownership: {
        exactClaims: [{ protocolVersion: 22, sessionId: 'exact-pty' }],
        legacyProtectedSessionIds: []
      }
    })
  })

  it.each([
    ownership({ claims: [paneClaim('exact-pty')] }),
    ownership({
      claims: [paneClaim('exact-pty', 21)],
      provenance: { 'exact-pty': { kind: 'local-daemon', protocolVersion: 22 } }
    }),
    ownership({
      claims: [paneClaim('exact-pty', 22, { ownerId: LEAF_B })],
      provenance: { 'exact-pty': { kind: 'local-daemon', protocolVersion: 22 } }
    })
  ])('fails closed on missing or disagreeing current projections', (daemonSessionOwnership) => {
    const result = extractRawDaemonOwnership(
      state({
        workspaceSession: workspace({
          tabPtyId: 'exact-pty',
          layoutPtyIds: { [LEAF_A]: 'exact-pty' }
        }),
        daemonSessionOwnership
      })
    )

    expect(result).toMatchObject({
      status: 'incomplete',
      reason: 'ownership-projection-mismatch'
    })
  })

  it('rejects an extra pane claim whose protocol disagrees with the physical binding', () => {
    const result = extractRawDaemonOwnership(
      state({
        workspaceSession: workspace({
          tabPtyId: 'exact-pty',
          layoutPtyIds: { [LEAF_A]: 'exact-pty' }
        }),
        daemonSessionOwnership: ownership({
          claims: [paneClaim('exact-pty', 22), paneClaim('exact-pty', 21)],
          provenance: { 'exact-pty': { kind: 'local-daemon', protocolVersion: 22 } }
        })
      })
    )

    expect(result).toMatchObject({ status: 'incomplete' })
  })

  it('accepts explicit fallback and remote provenance without daemon claims', () => {
    const fallback = extractRawDaemonOwnership(
      state({
        workspaceSession: workspace({ tabPtyId: 'fallback-pty' }),
        daemonSessionOwnership: ownership({
          provenance: { 'fallback-pty': { kind: 'local-fallback' } }
        })
      })
    )
    const remote = extractRawDaemonOwnership(
      state({
        workspaceSession: workspace({ tabPtyId: REMOTE_ID }),
        daemonSessionOwnership: ownership({
          provenance: { [REMOTE_ID]: { kind: 'remote', providerId: 'ssh-target' } }
        })
      })
    )

    expect(fallback).toMatchObject({ status: 'complete', ownership: { exactClaims: [] } })
    expect(remote).toMatchObject({ status: 'complete', ownership: { exactClaims: [] } })
  })

  it('validates an unbound local sleeping route against its exact claim', () => {
    const paneKey = `tab-a:${LEAF_A}`
    const claim = paneClaim('sleep-pty', 22, { ownerKind: 'sleep-route', ownerId: paneKey })
    const result = extractRawDaemonOwnership(
      state({
        workspaceSession: workspace({ sleeping: { [paneKey]: sleepingRecord(paneKey) } }),
        daemonSessionOwnership: ownership({
          claims: [claim],
          provenance: { 'sleep-pty': { kind: 'local-daemon', protocolVersion: 22 } }
        })
      })
    )

    expect(result).toMatchObject({
      status: 'complete',
      ownership: { exactClaims: [{ protocolVersion: 22, sessionId: 'sleep-pty' }] }
    })
  })

  it('accepts a conservatively protected fallback sleeping route', () => {
    const paneKey = `tab-a:${LEAF_A}`
    const result = extractRawDaemonOwnership(
      state({
        workspaceSession: workspace({
          tabPtyId: 'legacy-sleep-pty',
          layoutPtyIds: { [LEAF_A]: 'legacy-sleep-pty' },
          sleeping: { [paneKey]: sleepingRecord(paneKey) }
        }),
        daemonSessionOwnership: ownership({
          provenance: { 'legacy-sleep-pty': { kind: 'local-fallback' } },
          protectedIds: ['legacy-sleep-pty']
        })
      })
    )

    expect(result).toEqual({
      status: 'complete',
      ownership: {
        exactClaims: [],
        legacyProtectedSessionIds: ['legacy-sleep-pty']
      }
    })
  })

  it('preserves sidecar and explicit legacy protection alongside exact claims', () => {
    const result = extractRawDaemonOwnership(
      state({
        claudeLivePtySessionIds: ['sidecar'],
        daemonSessionOwnership: ownership({
          claims: [paneClaim('runtime-pty', 22, { ownerKind: 'runtime' })],
          protectedIds: ['legacy-protected']
        })
      })
    )

    expect(result).toMatchObject({
      status: 'complete',
      ownership: {
        exactClaims: [{ protocolVersion: 22, sessionId: 'runtime-pty' }],
        legacyProtectedSessionIds: ['sidecar', 'legacy-protected']
      }
    })
  })

  it.each([
    {
      schemaVersion: 2,
      claims: [],
      legacyProtectedSessionIds: [],
      bindingProvenanceByPtyId: {},
      projectTransferLineage: []
    },
    {
      schemaVersion: 1,
      claims: 'not-an-array',
      legacyProtectedSessionIds: [],
      bindingProvenanceByPtyId: {},
      projectTransferLineage: []
    }
  ])('rejects future and malformed current ownership', (daemonSessionOwnership) => {
    expect(extractRawDaemonOwnership(state({ daemonSessionOwnership }))).toMatchObject({
      status: 'incomplete',
      reason: 'malformed-current-ownership'
    })
  })
})

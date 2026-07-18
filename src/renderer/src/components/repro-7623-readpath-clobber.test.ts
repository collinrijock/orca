import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { LOCAL_EXECUTION_HOST_ID, toRuntimeExecutionHostId } from '../../../shared/execution-host'
import {
  getTaskSourceRuntimeSettings,
  normalizeTaskSourceContext,
  type TaskSourceContext
} from '../../../shared/task-source-context'
import { getGitHubMutationRoutingSettings } from '../lib/github-source-runtime-context'
import {
  getSettingsForRepoRuntimeOwner,
  type RepoRuntimeOwnerState
} from '../lib/repo-runtime-owner'
import { getActiveRuntimeTarget } from '../runtime/runtime-rpc-client'

// Repro for issue #7623 (read-path siblings of the #6957 / #7590 merge-routing bug).
//
// The read-only assignee/label/reviewer panels in PullRequestPage.tsx and
// GitHubItemDialog.tsx resolve their runtime routing with an UNCONDITIONAL spread:
//
//   sourceSettings =
//     sourceContext?.provider === 'github'
//       ? { ...repoOwnerSettings, ...getTaskSourceRuntimeSettings(sourceContext) }
//       : repoOwnerSettings
//
// `getTaskSourceRuntimeSettings` ALWAYS returns an object whose
// `activeRuntimeEnvironmentId` key is present (value `null` for a local source
// host). So spreading it unconditionally over `repoOwnerSettings` clobbers a
// valid repo-owner runtime id with `null` for a runtime-owned repo that is being
// viewed through a LOCAL GitHub source. The reads then route to the local host
// instead of the owner runtime (stale / empty metadata).
//
// The merge/mutation path was fixed (#7590 for the dialog, #7739 for the PR page)
// by routing through `getGitHubMutationRoutingSettings`, which is repo-owner-first
// and only lets a *runtime* source override. These read paths were left behind.

const COMPONENT_ROOT = __dirname

const OWNER_ENV_ID = 'env-owner-runtime'
const REPO_ID = 'repo-runtime-owned'

// A runtime-owned repo: its execution host is a runtime environment.
const runtimeOwnerState: RepoRuntimeOwnerState = {
  repos: [
    {
      id: REPO_ID,
      connectionId: null,
      executionHostId: toRuntimeExecutionHostId(OWNER_ENV_ID)
    }
  ],
  // The globally focused runtime is intentionally different / absent so we prove
  // the owner id comes from the repo, not focus.
  settings: { activeRuntimeEnvironmentId: null }
}

// The GitHub source is being viewed LOCALLY (hostId = local), even though the
// repo is runtime-owned. This is the exact #6957 topology.
const localGitHubSource = normalizeTaskSourceContext({
  provider: 'github',
  projectId: 'project-1',
  hostId: LOCAL_EXECUTION_HOST_ID,
  repoId: REPO_ID
}) as TaskSourceContext

// This mirrors the exact spread expression the read-path panels perform. The
// two operands are the REAL product helpers; only their combination (the spread)
// is inlined here because it lives inside a React component body.
function readPathSourceSettings(): { activeRuntimeEnvironmentId: string | null } {
  const repoOwnerSettings = getSettingsForRepoRuntimeOwner(runtimeOwnerState, REPO_ID)
  return localGitHubSource.provider === 'github'
    ? { ...repoOwnerSettings, ...getTaskSourceRuntimeSettings(localGitHubSource) }
    : repoOwnerSettings
}

describe('#7623 read-path runtime routing clobber', () => {
  it('repo owner is correctly a runtime environment before the spread', () => {
    const repoOwnerSettings = getSettingsForRepoRuntimeOwner(runtimeOwnerState, REPO_ID)
    // The owner host is correctly resolved to the runtime environment.
    expect(repoOwnerSettings.activeRuntimeEnvironmentId).toBe(OWNER_ENV_ID)
    expect(getActiveRuntimeTarget(repoOwnerSettings)).toEqual({
      kind: 'environment',
      environmentId: OWNER_ENV_ID
    })
  })

  it('local source yields a null runtime id (the value that gets spread)', () => {
    // getTaskSourceRuntimeSettings for a local host has the key PRESENT = null.
    expect(getTaskSourceRuntimeSettings(localGitHubSource)).toEqual({
      activeRuntimeEnvironmentId: null
    })
  })

  it('BUG: unconditional spread clobbers the owner runtime id to null', () => {
    const sourceSettings = readPathSourceSettings()

    // --- BUGGY BEHAVIOR PINNED HERE ---
    // The runtime owner (`env-owner-runtime`) is silently overwritten with null,
    // so the read routes to the LOCAL host instead of the owner runtime.
    expect(sourceSettings.activeRuntimeEnvironmentId).toBeNull()
    expect(getActiveRuntimeTarget(sourceSettings)).toEqual({ kind: 'local' })

    // --- CORRECT BEHAVIOR (what the mutation path already does) ---
    // The repo-owner-aware helper preserves the runtime owner for a local source.
    const correct = getGitHubMutationRoutingSettings(runtimeOwnerState, REPO_ID, localGitHubSource)
    expect(correct.activeRuntimeEnvironmentId).toBe(OWNER_ENV_ID)
    expect(getActiveRuntimeTarget(correct)).toEqual({
      kind: 'environment',
      environmentId: OWNER_ENV_ID
    })
  })
})

// Structural guard: prove the buggy pattern is actually LIVE at the read-path
// sites in the current tree (so a fix to any of them flips these assertions),
// while the merge path already uses the guarded helper.
function componentSource(relativePath: string): string {
  return readFileSync(join(COMPONENT_ROOT, relativePath), 'utf8')
}

const UNCONDITIONAL_SPREAD = '...getTaskSourceRuntimeSettings(sourceContext)'

describe('#7623 read-path spread is still present in product source', () => {
  it('PullRequestPage read panels use the unconditional spread', () => {
    const source = componentSource('PullRequestPage.tsx')
    // Read panels (assignees / reviewers / conversation / edit) still spread.
    const occurrences = source.split(UNCONDITIONAL_SPREAD).length - 1
    expect(occurrences).toBeGreaterThanOrEqual(3)
    // Merge path was fixed (#7739) and no longer spreads.
    expect(source).toContain('getGitHubMutationRoutingSettings(')
  })

  it('GitHubItemDialog read panels use the unconditional spread', () => {
    const source = componentSource('GitHubItemDialog.tsx')
    const occurrences = source.split(UNCONDITIONAL_SPREAD).length - 1
    expect(occurrences).toBeGreaterThanOrEqual(2)
    expect(source).toContain('getGitHubMutationRoutingSettings(')
  })
})

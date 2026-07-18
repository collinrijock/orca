import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Repro for issue #4396: "Linear and GitHub issue Use actions force new
// workspace setup".
//
// This test PINS the CURRENT (partially buggy) routing wiring so the repro is
// re-runnable. It reads the real product source (the routing lives inline in
// the 11k-line TaskPage React component and cannot be imported in isolation)
// and asserts what each "Use" action routes to today.
//
// Findings encoded below:
//   * GitHub half — FIXED since the issue was filed. `handleUseWorkItem` now
//     routes through `createGitHubWorkItemWorkspaceInBackground` (a direct
//     background-create path that does NOT open the composer in the happy case).
//   * Linear half — STILL BUGGY. `handleUseLinearItem` routes straight to
//     `openModal('new-workspace-composer', ...)`, forcing the New Workspace
//     setup flow, even though `launchWorkItemDirect` already supports Linear
//     issues via `linearIdentifier` and is never wired to the Linear action.
//
// Assertions marked `BUG:` encode the wrong/undesired behavior. When #4396 is
// fixed for Linear (wire the Linear Use action to launchWorkItemDirect / a
// background-create path), those assertions must be updated.

const taskPageSource = readFileSync(new URL('./TaskPage.tsx', import.meta.url), 'utf8')
const launchDirectSource = readFileSync(
  new URL('../lib/launch-work-item-direct.ts', import.meta.url),
  'utf8'
)

function sliceBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  expect(start, `expected to find ${startMarker}`).toBeGreaterThanOrEqual(0)
  const end = source.indexOf(endMarker, start + startMarker.length)
  expect(end, `expected to find ${endMarker} after ${startMarker}`).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('issue #4396: Linear/GitHub Use action routing', () => {
  it('GitHub Use action goes through the direct background-create path (fixed half)', () => {
    const handleUseWorkItem = sliceBetween(
      taskPageSource,
      'const handleUseWorkItem = useCallback',
      'const handleOpenOrUseGitHubWorkItem'
    )
    // GitHub no longer force-opens the composer: it stages a background create
    // and only uses the composer as a fallback for degraded cases.
    expect(handleUseWorkItem).toContain('createGitHubWorkItemWorkspaceInBackground({')
    expect(handleUseWorkItem).toContain('openModalFallback: () => openComposerForItem(item)')
  })

  it('BUG: Linear Use action routes straight to the New Workspace composer', () => {
    const handleUseLinearItem = sliceBetween(
      taskPageSource,
      'const handleUseLinearItem = useCallback',
      'const openComposerForJiraItem'
    )
    // BUG: the Linear Use action only records telemetry and opens the composer —
    // there is no attachment reuse and no direct/background launch path.
    expect(handleUseLinearItem).toContain('openComposerForLinearItem(issue)')
    // BUG: there is no createLinear...InBackground / launchWorkItemDirect call
    // on the Linear Use path (contrast with the GitHub half above).
    expect(handleUseLinearItem).not.toContain('InBackground')
    expect(handleUseLinearItem).not.toContain('launchWorkItemDirect')

    const openComposerForLinearItem = sliceBetween(
      taskPageSource,
      'const openComposerForLinearItem = useCallback',
      'const handleUseLinearItem'
    )
    // BUG: the Linear Use action's only launch route opens the composer modal,
    // forcing the user through New Workspace setup for an existing issue.
    expect(openComposerForLinearItem).toContain("openModal('new-workspace-composer'")
  })

  it('BUG: TaskPage never wires launchWorkItemDirect, so no Use action uses the direct path', () => {
    // The GitHub project / PR / fix-check flows import launchWorkItemDirect in
    // their own modules, but the normal issue surfaces in TaskPage never do —
    // so the Linear Use action cannot reach the existing direct launch path.
    expect(taskPageSource).not.toContain('launchWorkItemDirect')
  })

  it('the existing direct launch path already supports Linear issues (unused capability)', () => {
    // launch-work-item-direct.ts threads Linear metadata via `linearIdentifier`,
    // proving the direct path the issue references can handle Linear issues —
    // it is simply never invoked from the Linear Use action.
    expect(launchDirectSource).toContain('item.linearIdentifier')
    expect(launchDirectSource).toContain('getLinearIssueWorkspaceName')
  })
})

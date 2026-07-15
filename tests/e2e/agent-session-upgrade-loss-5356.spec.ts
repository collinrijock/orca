import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { test, expect } from './helpers/orca-app'
import { getE2ECompletedOnboardingProfile } from './helpers/e2e-completed-onboarding-profile'
import { waitForSessionReady } from './helpers/store'
import { createRestartSession } from './helpers/orca-restart'

// #5356: the first launch after upgrading FROM a pre-#5232 version silently
// replaces every live floating-terminal agent session with a blank shell.
// Pre-fix builds never wrote `sleepingAgentSessionsByPaneKey` at quit, so the
// pane-level cold-restore finds nothing to resume and spawns a fresh shell —
// with no warning at all.
//
// This seeds orca-data.json with exactly what such a pre-fix quit left on disk:
// an agent terminal tab (`launchAgent`, which pre-fix builds DID persist), no
// resume records, and no post-fix capability stamp. On the first launch of the
// fixed build the session is unrecoverable (it genuinely cannot be conjured),
// so the app must NON-DESTRUCTIVELY tell the user instead of silently swapping
// in a blank shell.

/** A workspace session shaped exactly like a pre-#5232 quit payload. */
function preFixWorkspaceSession(): Record<string, unknown> {
  return {
    activeRepoId: null,
    activeWorktreeId: 'wt-5356',
    activeTabId: 'tab5356',
    tabsByWorktree: {
      'wt-5356': [
        {
          id: 'tab5356',
          ptyId: null,
          worktreeId: 'wt-5356',
          title: 'Codex',
          customTitle: null,
          color: null,
          sortOrder: 0,
          createdAt: 1,
          // Pre-fix builds already persisted launchAgent, so a live agent tab
          // is identifiable on disk even though its session id is gone.
          launchAgent: 'codex'
        }
      ]
    },
    terminalLayoutsByTabId: {}
    // No sleepingAgentSessionsByPaneKey, no agentSessionCaptureVersion — that
    // absence is precisely the pre-#5232 state.
  }
}

function seedPreFixProfile(userDataDir: string): void {
  const profile = {
    ...getE2ECompletedOnboardingProfile(),
    workspaceSession: preFixWorkspaceSession()
  }
  writeFileSync(path.join(userDataDir, 'orca-data.json'), `${JSON.stringify(profile, null, 2)}\n`)
}

test('#5356 warns instead of silently dropping agent sessions when upgrading from a pre-#5232 version', async (// oxlint-disable-next-line no-empty-pattern -- Playwright's second fixture arg is testInfo; the first must be an object destructure to opt out of the default fixture set.
{}, testInfo) => {
  const session = createRestartSession(testInfo)

  try {
    // The first launch after the update reads a pre-#5232 session off disk.
    seedPreFixProfile(session.userDataDir)

    const { app, page } = await session.launch()
    await waitForSessionReady(page)

    // Capture the loaded-pre-fix-session state either way: pre-fix builds show
    // no notice here (the silent loss), the fixed build shows the warning.
    await page.waitForTimeout(3_000)
    await page.screenshot({
      path: testInfo.outputPath('after-upgrade-relaunch.png'),
      fullPage: true
    })

    // The lost agent session cannot be conjured, so the user must be told
    // NON-DESTRUCTIVELY that agent state from the previous version could not be
    // recovered. Pre-fix this notice is absent — that silent loss is the bug.
    const notice = page.getByTestId('pre-upgrade-agent-session-loss-notice')
    await expect(notice).toBeVisible({ timeout: 20_000 })

    await page.screenshot({
      path: testInfo.outputPath('upgrade-loss-notice.png'),
      fullPage: true
    })

    await session.close(app)
  } finally {
    await session.dispose()
  }
})

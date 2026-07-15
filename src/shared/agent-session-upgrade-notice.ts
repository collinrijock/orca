import type { WorkspaceSessionState } from './types'
import { isResumableTuiAgent } from './agent-session-resume'

/**
 * Bumped whenever the quit-time agent-session capture format changes. A session
 * persisted by a build that captures live agents at quit (#5232/#5240) carries
 * this stamp; builds predating that fix never wrote it. The *absence* of the
 * stamp is the load-bearing signal that the previous writer could not preserve
 * agent sessions across a restart — so it must NOT be added to
 * getDefaultWorkspaceSession (a default would misclassify genuine pre-fix
 * sessions as post-fix).
 */
export const AGENT_SESSION_CAPTURE_VERSION = 1

type PreUpgradeNoticeSession = Pick<
  WorkspaceSessionState,
  'agentSessionCaptureVersion' | 'tabsByWorktree' | 'sleepingAgentSessionsByPaneKey'
>

function hasRestorableAgentTab(
  tabsByWorktree: WorkspaceSessionState['tabsByWorktree'] | undefined
): boolean {
  if (!tabsByWorktree) {
    return false
  }
  for (const tabs of Object.values(tabsByWorktree)) {
    for (const tab of tabs) {
      if (tab.launchAgent && isResumableTuiAgent(tab.launchAgent)) {
        return true
      }
    }
  }
  return false
}

function hasQuitOrLiveCaptureRecord(
  records: WorkspaceSessionState['sleepingAgentSessionsByPaneKey'] | undefined
): boolean {
  if (!records) {
    return false
  }
  for (const record of Object.values(records)) {
    if (record.origin === 'quit' || record.origin === 'live') {
      return true
    }
  }
  return false
}

/**
 * True when a restored session was written by a build predating quit-time agent
 * capture (#5232) AND carried an agent terminal whose live session can no
 * longer be resumed — the #5356 silent-loss case. The user gets a one-time,
 * non-destructive notice instead of a blank shell appearing with no explanation.
 *
 * Deliberately conservative to avoid false alarms on the very first launch of
 * the fixed build, when *every* prior session still lacks the brand-new stamp:
 *   - a present/current stamp means the writer captured sessions → never warn;
 *   - a quit/live capture record means the writer DID persist resumable agents
 *     (a working post-#5232 build) → those sessions are being restored, so
 *     never warn even though the stamp is not yet present;
 *   - only warn when the previous session actually had a resumable agent tab
 *     (`launchAgent`, which pre-fix builds already persisted) to lose.
 */
export function shouldNotifyPreUpgradeAgentSessionLoss(session: PreUpgradeNoticeSession): boolean {
  if ((session.agentSessionCaptureVersion ?? 0) >= AGENT_SESSION_CAPTURE_VERSION) {
    return false
  }
  if (hasQuitOrLiveCaptureRecord(session.sleepingAgentSessionsByPaneKey)) {
    return false
  }
  return hasRestorableAgentTab(session.tabsByWorktree)
}

import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { WorkspaceSessionState } from '../../../shared/types'
import {
  AGENT_SESSION_CAPTURE_VERSION,
  shouldNotifyPreUpgradeAgentSessionLoss
} from '../../../shared/agent-session-upgrade-notice'
import { patchWorkspaceSessionByHost } from './workspace-session-host-persistence'

/**
 * On the first launch after upgrading from a build predating quit-time agent
 * capture (#5232), a live agent terminal cold-restores as a blank shell because
 * its session id was never persisted — and, before this notice, silently
 * (#5356). The lost session cannot be conjured, so tell the user once,
 * non-destructively, then stamp the session so it never re-fires.
 */
export function notifyPreUpgradeAgentSessionLossIfNeeded(session: WorkspaceSessionState): void {
  // Fast path: a capture-capable build already stamped this session — no notice
  // to show and nothing to reconcile, so skip the extra disk write too.
  if ((session.agentSessionCaptureVersion ?? 0) >= AGENT_SESSION_CAPTURE_VERSION) {
    return
  }

  // Why: this runs inline in the startup hydration path, so a fault here must
  // never block the app from mounting — degrade to "no notice" instead.
  try {
    if (shouldNotifyPreUpgradeAgentSessionLoss(session)) {
      toast(
        <span data-testid="pre-upgrade-agent-session-loss-notice">
          {translate(
            'auto.App.preUpgradeAgentSessionLossTitle',
            'Agent sessions could not be restored'
          )}
        </span>,
        {
          description: translate(
            'auto.App.preUpgradeAgentSessionLossBody',
            'After updating, agent terminals (Claude, Codex, and others) from your previous session started as fresh shells. Older versions could not save agent sessions across an update, so they could not be resumed. This will not happen again.'
          ),
          // Sticky + dismissible: important enough to be seen, but purely
          // informational — it blocks nothing and deletes nothing.
          duration: Infinity,
          dismissible: true
        }
      )
    }

    // Consume the pre-fix signal immediately (not only at the next graceful
    // quit) so a crash before quit can't replay the notice.
    void patchWorkspaceSessionByHost(
      window.api.session,
      { agentSessionCaptureVersion: AGENT_SESSION_CAPTURE_VERSION },
      useAppStore.getState()
    ).catch(() => {
      // Best-effort: the quit-time full write re-stamps, so a failed patch just
      // means the notice may re-evaluate next launch, never a crash.
    })
  } catch {
    // Non-fatal: never let the upgrade notice interfere with startup.
  }
}

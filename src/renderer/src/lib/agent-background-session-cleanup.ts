import { killPtyRetainingRetryOwnership } from '@/lib/pty-kill-retry-ownership'
import { closeRuntimeTerminalRetainingRetryOwnership } from '@/lib/runtime-terminal-close-retry-ownership'
import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'

export function runBestEffortAgentBackgroundCleanups(...actions: (() => void)[]): void {
  for (const action of actions) {
    try {
      action()
    } catch {
      // Preserve the launch/setup error that triggered cleanup.
    }
  }
}

export function killFailedAgentBackgroundPty(ptyId: string, tabId: string): Promise<void> {
  return killPtyRetainingRetryOwnership(ptyId, '[pty] Background cleanup failed', {
    expectedTabId: tabId
  })
}

export function closeFailedAgentBackgroundRuntimeTerminal(
  environmentId: string,
  handle: string
): Promise<void> {
  return closeRuntimeTerminalRetainingRetryOwnership({ kind: 'environment', environmentId }, handle)
}

export async function cleanupFailedAgentBackgroundSession(args: {
  unsubscribeExit: () => void
  unsubscribeData: () => void
  disposeEagerBuffer: () => void
  clearStartupDelivery: () => void
  clearTabPtyId: () => void
  clearLaunchConfig: () => void
  closeTab: () => void
  ptyId: string
  tabId: string
  runtimeTarget: RuntimeClientTarget
  runtimeTerminalHandle: string | null
}): Promise<void> {
  runBestEffortAgentBackgroundCleanups(args.unsubscribeExit, args.unsubscribeData)
  runBestEffortAgentBackgroundCleanups(args.disposeEagerBuffer)
  runBestEffortAgentBackgroundCleanups(args.clearStartupDelivery)
  runBestEffortAgentBackgroundCleanups(args.clearTabPtyId)
  runBestEffortAgentBackgroundCleanups(args.clearLaunchConfig)
  if (args.ptyId) {
    try {
      if (args.runtimeTarget.kind === 'environment' && args.runtimeTerminalHandle) {
        await closeFailedAgentBackgroundRuntimeTerminal(
          args.runtimeTarget.environmentId,
          args.runtimeTerminalHandle
        )
      } else if (args.runtimeTarget.kind === 'local') {
        await killFailedAgentBackgroundPty(args.ptyId, args.tabId)
      }
    } catch {
      // Best-effort close; retiring the invalid hidden tab must still proceed.
    }
  }
  runBestEffortAgentBackgroundCleanups(args.closeTab)
}

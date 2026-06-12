import type { GlobalSettings } from '../../../../shared/types'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import {
  getRemoteRuntimePtyEnvironmentId,
  getRemoteRuntimeTerminalHandle
} from '@/runtime/runtime-terminal-stream'

type TerminalFitRestoreSettings = Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null

export async function restoreTerminalFitToDesktop(
  ptyId: string,
  settings: TerminalFitRestoreSettings | undefined
): Promise<boolean> {
  const remoteHandle = getRemoteRuntimeTerminalHandle(ptyId)
  const environmentId =
    getRemoteRuntimePtyEnvironmentId(ptyId) ?? settings?.activeRuntimeEnvironmentId ?? null
  const result =
    remoteHandle && environmentId
      ? await callRuntimeRpc<{ restored: boolean }>(
          { kind: 'environment', environmentId },
          'terminal.restoreFit',
          { terminal: remoteHandle },
          { timeoutMs: 15_000 }
        ).catch(() => ({ restored: false }))
      : await window.api.runtime.restoreTerminalFit(ptyId).catch(() => ({ restored: false }))

  return result.restored
}

export async function restoreTerminalFitsToDesktop(
  ptyIds: Iterable<string>,
  settings: TerminalFitRestoreSettings | undefined
): Promise<boolean> {
  const uniquePtyIds = [...new Set(ptyIds)]
  const results = await Promise.all(
    uniquePtyIds.map((ptyId) => restoreTerminalFitToDesktop(ptyId, settings))
  )
  return results.some(Boolean)
}

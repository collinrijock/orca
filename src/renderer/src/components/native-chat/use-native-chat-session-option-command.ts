import { useCallback, type Dispatch, type SetStateAction } from 'react'
import type { AgentType } from '../../../../shared/agent-status-types'
import { emitNativeChatMessageSent } from '@/lib/native-chat-telemetry'
import {
  nativeChatComposerTargetIsRemote,
  type NativeChatResolvedTarget
} from './native-chat-composer-target'
import { pushHistory, type HistoryState } from './native-chat-composer-state'
import { sendNativeChatMessage } from './native-chat-runtime-send'
import type { NativeChatSendLifecycle } from './use-native-chat-send-lifecycle'

export function useNativeChatSessionOptionCommand(args: {
  agent: AgentType
  disabled: boolean
  onSlashCommand?: (command: string) => void
  resolveTarget: () => NativeChatResolvedTarget | null
  setHistory: Dispatch<SetStateAction<HistoryState>>
  trackPendingSend: NativeChatSendLifecycle['trackPendingSend']
}): (command: string) => Promise<void> {
  const { agent, disabled, onSlashCommand, resolveTarget, setHistory, trackPendingSend } = args
  return useCallback(
    async (command: string): Promise<void> => {
      const target = resolveTarget()
      if (!target || disabled) {
        throw new Error('No live terminal is available.')
      }
      const handle = sendNativeChatMessage(target.settings, target.ptyId, command)
      trackPendingSend(handle)
      onSlashCommand?.(command.trim())
      emitNativeChatMessageSent({
        agent,
        runtime: nativeChatComposerTargetIsRemote(target.ptyId) ? 'remote' : 'local'
      })
      setHistory((previous) => pushHistory(previous, command))
      // Why: picker actions switch views; wait for the delayed Enter so
      // unmount cleanup cannot cancel the command halfway through dispatch.
      await new Promise((resolve) => setTimeout(resolve, handle.settleAfterMs + 10))
    },
    [agent, disabled, onSlashCommand, resolveTarget, setHistory, trackPendingSend]
  )
}

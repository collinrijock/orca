import type { MessageRow, MessageType } from './types'

// Why: only actionable lifecycle messages should steer an active coordinator;
// progress traffic remains in the persisted inbox until the next idle turn.
export const COORDINATOR_WAKE_MESSAGE_TYPES: MessageType[] = [
  'worker_done',
  'escalation',
  'decision_gate'
]

export function shouldWakeCoordinatorForMessage(type: MessageType): boolean {
  return COORDINATOR_WAKE_MESSAGE_TYPES.includes(type)
}

// Structural view of the runtime so every insert-time caller (RPC methods and
// the runtime's own exit escalation) shares one delivery entry point.
export type OrchestrationMessageDeliverer = {
  deliverPendingMessagesForHandle(
    handle: string,
    options?: { wakeAgent?: boolean; messageType?: MessageType }
  ): void
  notifyMessageArrived(handle: string, messageType?: string): void
}

// Why: delivery MUST run before notify. The push path treats a still-blocked
// matching waiter as the delivery owner; notify resolves (and removes) that
// waiter, so the reversed order would make both paths observe the message.
export function deliverOrchestrationMessage(
  runtime: OrchestrationMessageDeliverer,
  message: Pick<MessageRow, 'to_handle' | 'type'>
): void {
  if (shouldWakeCoordinatorForMessage(message.type)) {
    runtime.deliverPendingMessagesForHandle(message.to_handle, {
      wakeAgent: true,
      messageType: message.type
    })
  } else {
    runtime.deliverPendingMessagesForHandle(message.to_handle)
  }
  runtime.notifyMessageArrived(message.to_handle, message.type)
}

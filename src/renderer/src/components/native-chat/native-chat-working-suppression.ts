export function shouldShowNativeChatWorking(args: {
  isConversation: boolean
  working: boolean
  interrupted: boolean
}): boolean {
  return args.isConversation && args.working && !args.interrupted
}

export function shouldClearNativeChatWorkingSuppression(args: { working: boolean }): boolean {
  return !args.working
}

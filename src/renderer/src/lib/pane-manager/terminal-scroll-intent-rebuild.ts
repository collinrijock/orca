// Why: buffer rebuilds (snapshot replay clear + rewrite) parse asynchronously.
// Until the rebuild's bytes have parsed, viewportY/baseY describe a transient
// half-cleared buffer; any intent capture/enforce latched from it pins the
// terminal at line 0. Callers bracket the rebuild and re-apply intent once
// after parse (see terminal-scroll-intent.ts).
const terminalScrollIntentRebuilds = new WeakMap<object, number>()

export function beginTerminalScrollIntentBufferRebuild(terminal: object): void {
  terminalScrollIntentRebuilds.set(terminal, (terminalScrollIntentRebuilds.get(terminal) ?? 0) + 1)
}

export function endTerminalScrollIntentBufferRebuild(terminal: object): void {
  const count = terminalScrollIntentRebuilds.get(terminal) ?? 0
  if (count <= 1) {
    terminalScrollIntentRebuilds.delete(terminal)
    return
  }
  terminalScrollIntentRebuilds.set(terminal, count - 1)
}

export function isTerminalScrollIntentRebuildInFlight(terminal: object): boolean {
  return (terminalScrollIntentRebuilds.get(terminal) ?? 0) > 0
}

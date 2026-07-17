import path from 'node:path'
import { resolveCliCommands } from '../codex-cli/command'

// Why: one bulk filesystem pass avoids a `which`/`where` subprocess per agent;
// spawning that fan-out can hold Electron's main loop for over a second on macOS.
// The pass itself must stay async — it runs on the main process, where a slow
// PATH entry (dead network mount) would otherwise freeze the whole app.
export async function detectLocalCommands(commands: readonly string[]): Promise<Set<string>> {
  if (commands.length === 0) {
    return new Set()
  }
  try {
    const resolvedCommands = await resolveCliCommands(commands)
    return new Set(
      commands.filter((command) => path.isAbsolute(resolvedCommands.get(command) ?? command))
    )
  } catch {
    return new Set()
  }
}

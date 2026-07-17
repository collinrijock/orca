import path from 'node:path'
import { resolveCliCommands } from '../codex-cli/command'

// Why: one bulk filesystem pass avoids a `which`/`where` subprocess per agent;
// spawning that fan-out can hold Electron's main loop for over a second on macOS.
export function detectLocalCommands(commands: readonly string[]): Set<string> {
  try {
    const resolvedCommands = resolveCliCommands(commands)
    return new Set(
      commands.filter((command) => path.isAbsolute(resolvedCommands.get(command) ?? command))
    )
  } catch {
    return new Set()
  }
}

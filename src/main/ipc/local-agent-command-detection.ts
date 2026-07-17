import path from 'node:path'
import { resolveCliCommands } from '../codex-cli/command'
import { mergePersistedWindowsPath } from '../pty/windows-environment-path'

// Why: one bulk filesystem pass avoids a `which`/`where` subprocess per agent;
// spawning that fan-out can hold Electron's main loop for over a second on macOS.
// The pass itself must stay async — it runs on the main process, where a slow
// PATH entry (dead network mount) would otherwise freeze the whole app.
export async function detectLocalCommands(commands: readonly string[]): Promise<Set<string>> {
  if (commands.length === 0) {
    return new Set()
  }
  try {
    // Why: on Windows, a CLI installed while Orca runs updates the persisted
    // registry Path, not this process env, and shell-PATH hydration is a no-op
    // there. Merge it (into a copy) so Refresh finds new agents without a
    // relaunch, as the replaced `where` probe did. No-op off Windows.
    const env: NodeJS.ProcessEnv = { ...process.env }
    mergePersistedWindowsPath(env)
    const resolvedCommands = await resolveCliCommands(commands, {
      pathEnv: env.PATH ?? env.Path ?? null
    })
    return new Set(
      commands.filter((command) => path.isAbsolute(resolvedCommands.get(command) ?? command))
    )
  } catch {
    return new Set()
  }
}

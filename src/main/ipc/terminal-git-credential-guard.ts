import { promptGuardGitEnv } from '../git/runner'
import { recognizeAgentProcessFromCommandLine } from '../../shared/agent-process-recognition'

/**
 * Disable git's interactive credential prompt for a terminal's environment so a
 * git operation that needs GitHub auth cannot make the OS credential helper
 * (Git Credential Manager on Windows) pop its "Connect to GitHub" OAuth window
 * — which, in a network-restricted intranet, can never complete and gets
 * re-triggered in a loop by git's credential retry (issue #7652).
 *
 * The credential *helper* is kept, so cached-token auth still works; only the
 * interactive fallback prompt is suppressed. Agent terminals are always guarded
 * on every platform (an agent can't answer a prompt, so failing fast beats
 * hanging). User terminals are only guarded on Windows terminal hosts — the
 * popup is a Windows credential-manager behavior, and on other platforms the
 * guard would only take working tty prompts away from an interactive user —
 * and the user can opt out via settings.
 *
 * Mutates `env` in place to match how the PTY host assembles its environment.
 */
export function applyTerminalGitCredentialPromptGuard(
  env: Record<string, string>,
  opts: {
    launchCommand?: string | null
    suppressUserTerminalPrompt: boolean
    /** Injectable for tests; defaults to the spawning host's platform. */
    platform?: NodeJS.Platform
  }
): void {
  const isAgentTerminal = Boolean(recognizeAgentProcessFromCommandLine(opts.launchCommand))
  const platform = opts.platform ?? process.platform
  if (!isAgentTerminal && (!opts.suppressUserTerminalPrompt || platform !== 'win32')) {
    return
  }
  for (const [key, value] of Object.entries(promptGuardGitEnv(env, platform))) {
    if (typeof value === 'string') {
      env[key] = value
    }
  }
}

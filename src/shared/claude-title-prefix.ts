/**
 * Claude Code title-prefix identity primitives.
 *
 * Why a dedicated module: Claude Code prefixes its OSC title with a status
 * glyph (✳ idle) or punctuation (". " working, "* " idle) followed by the task
 * description. That task text frequently mentions other agents ("Compare Gemini
 * CLI vs Claude"), so the prefix — not the words — is Claude's identity signal.
 * Several detectors in `agent-detection` need this exact precedence check, and
 * keeping it in one place stops them from drifting (issue #5270).
 */

export const CLAUDE_IDLE = '✳' // ✳ (eight-spoked asterisk — Claude Code idle prefix)

export function hasClaudeStatusPrefix(title: string): boolean {
  // Why: Claude Code's own title-prefix identity signals (✳ idle, ". " working,
  // "* " idle) must win over agent-name tokens that only appear in task text.
  return (
    title.startsWith(`${CLAUDE_IDLE} `) ||
    title === CLAUDE_IDLE ||
    title.startsWith('. ') ||
    title.startsWith('* ')
  )
}

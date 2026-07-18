// Repro probe for issue #7323: "Injected Claude Code hooks (agent-flow/hook.js)
// have no timeout — up to 60s stall per prompt/tool call when Orca is not running".
//
// The issue claims Orca injects managed Claude hook entries WITHOUT a `timeout`
// field, so Claude Code's 60s default applies and every prompt/tool call can
// stall for up to a minute when the relay/app is not running.
//
// This test imports the REAL product injection path (`applyManagedHooks` +
// `CLAUDE_EVENTS` from src/main/claude/hook-settings.ts, which builds each entry
// via `buildManagedCommandHook` in src/main/agent-hooks/installer-utils.ts) and
// checks the actual injected config. If the bug were present, at least one
// injected hook command would ship with `timeout === undefined`.
//
// FINDING: it does NOT reproduce on the current tree. Every injected Claude hook
// carries an explicit numeric `timeout` (MANAGED_HOOK_TIMEOUT_SECONDS = 10),
// added by commit e03a1cf769 / PR #6148 "Prevent managed agent hooks from
// hanging". The 60s-default-timeout scenario the issue describes is closed.
import { describe, expect, it } from 'vitest'
import { applyManagedHooks, CLAUDE_EVENTS } from './hook-settings'
import { MANAGED_HOOK_TIMEOUT_SECONDS } from '../agent-hooks/installer-utils'

describe('repro #7323: injected Claude hooks declare an explicit timeout', () => {
  const injected = applyManagedHooks({}, 'echo managed-hook', 'claude-hook.sh')

  it('injects every documented Claude hook event', () => {
    for (const event of CLAUDE_EVENTS) {
      expect(injected.hooks?.[event.eventName]).toBeDefined()
    }
  })

  it('every injected hook command carries an explicit numeric timeout (bug would leave it undefined)', () => {
    const timeouts: (number | undefined)[] = []
    for (const event of CLAUDE_EVENTS) {
      const defs = injected.hooks?.[event.eventName] ?? []
      for (const def of defs) {
        for (const cmd of def.hooks ?? []) {
          timeouts.push(cmd.timeout)
        }
      }
    }

    // Sanity: we actually inspected the full set of injected commands.
    expect(timeouts.length).toBe(CLAUDE_EVENTS.length)

    // Bug (#7323) would show up here as at least one `undefined` timeout, which
    // makes Claude Code fall back to its 60s default. Current tree: all defined.
    for (const t of timeouts) {
      expect(t).toBeTypeOf('number')
      expect(t).toBe(MANAGED_HOOK_TIMEOUT_SECONDS)
    }

    // Explicit 10s host-level backstop — far below the 60s default the issue
    // reported. (The curl transport wrapper additionally bounds a dead relay at
    // `--max-time 1.5`, so the real-world stall is ~1.5s, not 60s.)
    expect(MANAGED_HOOK_TIMEOUT_SECONDS).toBeLessThan(60)
  })
})

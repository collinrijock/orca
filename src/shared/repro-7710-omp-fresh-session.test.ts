// Repro for issue #7710: OMP fresh launches can resume a previous session
// across new terminals/worktrees.
//
// Orca builds the launch command for a fresh OMP tab through
// `buildAgentStartupPlan` / `buildAgentDraftLaunchPlan`. For OMP (config in
// tui-agent-config.ts: launchCmd 'omp', promptInjectionMode 'argv') these paths
// emit a bare `omp` invocation with no fresh-session selector. OMP auto-resumes
// its most-recent session when invoked with no session flag, so an Orca-created
// "fresh" OMP tab in a new terminal/worktree reattaches to the previous
// session's transcript and draft state.
//
// The assertions below PIN THE BUG: they pass on the current tree while
// asserting the WRONG behavior. Each buggy assertion is called out, together
// with what the correct (post-fix) behavior should be.
import { describe, expect, it } from 'vitest'
import { buildAgentDraftLaunchPlan, buildAgentStartupPlan } from './tui-agent-startup'

// Selectors that make the OMP session intent explicit. A fresh Orca launch
// should carry a fresh-session selector (e.g. `--session-dir <fresh>` or
// `--no-session`); an explicit user selector should be preserved untouched.
const SESSION_SELECTOR_RE = /--session-dir|--no-session|--resume|--continue|--fork/

describe('repro #7710: fresh OMP launch omits a fresh-session selector', () => {
  it('empty-prompt fresh launch is a bare `omp` that OMP will auto-resume', () => {
    const plan = buildAgentStartupPlan({
      agent: 'omp',
      prompt: '',
      cmdOverrides: {},
      platform: 'darwin',
      allowEmptyPromptLaunch: true
    })

    // BUG: the command is exactly `omp` with no session selector. When OMP is
    // launched bare it auto-resumes the previous session, so this new tab
    // inherits another terminal/worktree's transcript.
    expect(plan?.launchCommand).toBe('omp')
    // BUG: no fresh-session directory / --no-session is injected.
    // CORRECT would be: SESSION_SELECTOR_RE.test(plan.launchCommand) === true.
    expect(SESSION_SELECTOR_RE.test(plan?.launchCommand ?? '')).toBe(false)
  })

  it('prompt fresh launch appends the prompt but still omits a fresh-session selector', () => {
    const plan = buildAgentStartupPlan({
      agent: 'omp',
      prompt: 'do a thing',
      cmdOverrides: {},
      platform: 'darwin'
    })

    // BUG: `omp <prompt>` with no session selector — still auto-resumes.
    expect(plan?.launchCommand).toBe("omp 'do a thing'")
    expect(SESSION_SELECTOR_RE.test(plan?.launchCommand ?? '')).toBe(false)
  })

  it('draft fresh launch omits a fresh-session selector', () => {
    const plan = buildAgentDraftLaunchPlan({
      agent: 'omp',
      draft: 'draft text',
      cmdOverrides: {},
      platform: 'darwin'
    })

    // BUG: draft launch is `omp; unset ORCA_OMP_PREFILL` — no session selector,
    // so an Orca-created draft tab also auto-resumes the prior session.
    expect(plan?.launchCommand).toBe('omp; unset ORCA_OMP_PREFILL')
    expect(SESSION_SELECTOR_RE.test(plan?.launchCommand ?? '')).toBe(false)
  })

  it('user-supplied session selector is (correctly) preserved today', () => {
    // This assertion documents the invariant a fix must keep: when the user
    // passes an explicit resume/session selector, it must survive to the
    // launch command. This already works and must not regress once a fresh
    // selector is injected only for the promptless/fresh path.
    const plan = buildAgentStartupPlan({
      agent: 'omp',
      prompt: '',
      cmdOverrides: {},
      platform: 'darwin',
      allowEmptyPromptLaunch: true,
      agentArgs: '--session-dir /tmp/user-picked'
    })

    expect(plan?.launchCommand).toContain('--session-dir')
    expect(plan?.launchCommand).toContain('/tmp/user-picked')
  })
})

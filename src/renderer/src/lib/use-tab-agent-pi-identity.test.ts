import { describe, expect, it } from 'vitest'
import { resolveTabAgentFromSignals } from './use-tab-agent'

// Pi/OMP share a title-identity group: OMP wraps Pi and emits Pi-compatible
// wrapper title frames. These tests pin how the tab-icon resolver keeps an
// OMP-owned pane on OMP (and a Pi-owned pane on Pi) as those frames arrive,
// including when the pane loses its host-owned launchAgent on a mirrored or
// restored client.
describe('resolveTabAgentFromSignals — Pi/OMP identity', () => {
  it('keeps OMP launch identity over Pi-compatible wrapper titles after activity', () => {
    expect(
      resolveTabAgentFromSignals({
        hasObservedAgentSignal: true,
        isRemote: true,
        title: '⠋ Pi',
        hookAgent: null,
        launchAgent: 'omp'
      })
    ).toBe('omp')

    expect(
      resolveTabAgentFromSignals({
        hasObservedAgentSignal: true,
        isRemote: true,
        title: '⠋ Pi',
        hookAgent: 'pi',
        launchAgent: 'omp'
      })
    ).toBe('omp')

    expect(
      resolveTabAgentFromSignals({
        hasObservedAgentSignal: true,
        isRemote: false,
        title: '⠋ Pi',
        hookAgent: 'pi',
        launchAgent: 'omp'
      })
    ).toBe('omp')

    expect(
      resolveTabAgentFromSignals({
        hasObservedAgentSignal: true,
        isRemote: true,
        title: 'Terminal 1',
        hookAgent: null,
        siblingHookAgent: 'pi',
        launchAgent: 'omp'
      })
    ).toBe('omp')

    expect(
      resolveTabAgentFromSignals({
        hasObservedAgentSignal: true,
        isRemote: true,
        title: '⠋ OMP',
        hookAgent: 'omp',
        launchAgent: 'pi'
      })
    ).toBe('pi')

    expect(
      resolveTabAgentFromSignals({
        hasObservedAgentSignal: true,
        isRemote: true,
        title: 'zsh',
        hookAgent: null,
        focusedCompletedHookAgent: 'pi',
        launchAgent: 'omp'
      })
    ).toBe('omp')

    expect(
      resolveTabAgentFromSignals({
        hasObservedAgentSignal: true,
        isRemote: false,
        title: 'zsh',
        hookAgent: null,
        siblingCompletedHookAgent: 'pi',
        launchAgent: 'omp'
      })
    ).toBe('omp')
  })

  it('keeps a restored/mirrored OMP pane on OMP when launchAgent is gone', () => {
    // Why: a mirrored or restored OMP pane loses its host-owned launchAgent but
    // keeps emitting Pi-compatible wrapper title frames. Durable pane identity
    // (last completed hook / hibernated session) must anchor those frames to OMP
    // instead of letting them repaint the tab as Pi.
    expect(
      resolveTabAgentFromSignals({
        hasObservedAgentSignal: true,
        isRemote: true,
        title: '⠋ Pi',
        hookAgent: null,
        focusedCompletedHookAgent: 'omp',
        launchAgent: undefined
      })
    ).toBe('omp')

    expect(
      resolveTabAgentFromSignals({
        hasObservedAgentSignal: true,
        isRemote: true,
        title: '⠋ Pi',
        hookAgent: null,
        sleepingSessionAgent: 'omp',
        launchAgent: undefined
      })
    ).toBe('omp')
  })

  it('does not flap between OMP and Pi as a launchAgent-less pane cycles hooks', () => {
    // The flicker: identity must not flip when the live hook row appears/clears.
    const withLiveHook = resolveTabAgentFromSignals({
      hasObservedAgentSignal: true,
      isRemote: true,
      title: '⠋ Pi',
      hookAgent: 'omp',
      focusedCompletedHookAgent: 'omp',
      launchAgent: undefined
    })
    const afterHookCleared = resolveTabAgentFromSignals({
      hasObservedAgentSignal: true,
      isRemote: true,
      title: '⠋ Pi',
      hookAgent: null,
      focusedCompletedHookAgent: 'omp',
      launchAgent: undefined
    })
    expect(withLiveHook).toBe('omp')
    expect(afterHookCleared).toBe('omp')
  })

  it('keeps a launchAgent-less Pi pane on Pi and rejects a stale OMP session record', () => {
    // The fallback must not over-reach: a genuine Pi pane (recent Pi hook) stays
    // Pi even if a stale hibernated OMP record is present.
    expect(
      resolveTabAgentFromSignals({
        hasObservedAgentSignal: true,
        isRemote: true,
        title: '⠋ Pi',
        hookAgent: null,
        focusedCompletedHookAgent: 'pi',
        sleepingSessionAgent: 'omp',
        launchAgent: undefined
      })
    ).toBe('pi')

    // An OMP-compatible title on a launchAgent-less Pi pane still resolves to Pi.
    expect(
      resolveTabAgentFromSignals({
        hasObservedAgentSignal: true,
        isRemote: true,
        title: '⠋ OMP',
        hookAgent: null,
        focusedCompletedHookAgent: 'pi',
        launchAgent: undefined
      })
    ).toBe('pi')
  })
})

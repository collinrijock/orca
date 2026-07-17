import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ProviderRateLimits } from '../../../../shared/rate-limit-types'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))
vi.mock('@/lib/agent-catalog', () => ({
  AgentIcon: ({ agent }: { agent: string }) => <span data-agent-icon={agent} />
}))

import { UsageRow } from './UsageRosterPanel'

const signedOutCodex: ProviderRateLimits = {
  provider: 'codex',
  session: null,
  weekly: null,
  updatedAt: 0,
  error: 'ChatGPT authentication required to read rate limits',
  status: 'error'
}

describe('UsageRow', () => {
  it('renders sign-in as row copy instead of nesting an interactive button', () => {
    const markup = renderToStaticMarkup(
      <UsageRow
        p={signedOutCodex}
        display="used"
        state={{ kind: 'sign-in', statusLabel: 'not signed in' }}
        showSignInAction
      />
    )

    expect(markup).toContain('not signed in')
    expect(markup).toContain('Sign in')
    expect(markup).not.toContain('<button')
  })

  it('keeps the bar fill consistent with the remaining percentage label', () => {
    const markup = renderToStaticMarkup(
      <UsageRow
        p={{
          ...signedOutCodex,
          session: {
            usedPercent: 25,
            windowMinutes: 300,
            resetsAt: null,
            resetDescription: null
          },
          status: 'ok',
          error: null
        }}
        display="remaining"
        state={{ kind: 'usage', statusLabel: null }}
        showSignInAction={false}
      />
    )

    expect(markup).toContain('75%')
    expect(markup).toContain('width:75%')
    expect(markup).not.toContain('width:25%')
  })
})

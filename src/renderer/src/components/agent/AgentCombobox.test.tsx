import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AGENT_CATALOG, AgentIcon } from '@/lib/agent-catalog'
import AgentCombobox from './AgentCombobox'

describe('AgentCombobox', () => {
  it('keeps enough trigger width for GitHub Copilot when callers pass min-w-0', () => {
    const markup = renderToStaticMarkup(
      <AgentCombobox
        agents={AGENT_CATALOG}
        value="copilot"
        onValueChange={vi.fn()}
        triggerClassName="h-9 w-full min-w-0"
      />
    )

    expect(markup).toContain('GitHub Copilot')
    expect(markup).toContain('!min-w-[260px]')
    expect(markup).toContain('flex-1')
  })

  it('uses the bundled OpenClaude favicon crop instead of Claude or GitHub artwork', () => {
    const markup = renderToStaticMarkup(<AgentIcon agent="openclaude" />)

    expect(markup).toContain('/resources/openclaude-logo.png')
    expect(markup).toContain('<img')
    expect(markup).not.toContain('https://github.com/Gitlawb.png')
    expect(markup).not.toContain('<svg')
  })

  it('uses the official OpenCode SVG mark instead of a remote favicon', () => {
    const markup = renderToStaticMarkup(<AgentIcon agent="opencode" />)

    expect(markup).toContain('<svg')
    expect(markup).toContain('viewBox="0 0 512 512"')
    expect(markup).not.toContain('/resources/opencode.webp')
    expect(markup).not.toContain('https://www.google.com/s2/favicons')
    expect(markup).not.toContain('<img')
  })

  it('renders bundled favicons for favicon-domain agents instead of the remote Google service', () => {
    // Why: these icons previously loaded from Google's favicon service, which is
    // unreachable in some regions/offline and left them broken (#8451).
    for (const agent of ['cursor', 'gemini', 'kimi', 'devin'] as const) {
      const markup = renderToStaticMarkup(<AgentIcon agent={agent} />)
      expect(markup).toContain(`/resources/agent-icons/${agent}.png`)
      expect(markup).not.toContain('https://www.google.com/s2/favicons')
    }
  })
})

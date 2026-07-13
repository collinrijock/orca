// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PluginHostListEntry, PreloadApi } from '../../../../preload/api-types'
import { PluginSkillMappingDialog } from './PluginSkillMappingDialog'

const roots: Root[] = []

const plugin: PluginHostListEntry = {
  pluginKey: 'orca-samples.skills',
  consentFingerprint: 'sha256-skills',
  name: 'Skills',
  version: '1.0.0',
  publisher: 'orca-samples',
  status: 'idle',
  needsReconsent: false,
  isDev: false,
  capabilities: [],
  panels: [],
  commands: [],
  hasWorker: false,
  hasSkills: true,
  restarts: 0
}

afterEach(async () => {
  for (const root of roots) {
    await act(async () => root.unmount())
  }
  roots.length = 0
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('PluginSkillMappingDialog', () => {
  it('saves the declared providers to user roots by default', async () => {
    const setSkillMapping = vi.fn().mockResolvedValue({ registrations: [], mappings: [] })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        plugins: {
          listSkillStore: vi.fn().mockResolvedValue({
            registrations: [
              {
                pluginKey: plugin.pluginKey,
                contributionPath: 'skills',
                skillName: 'review',
                providers: ['codex', 'claude'],
                materializedPaths: ['/skills/review']
              }
            ],
            mappings: []
          }),
          setSkillMapping
        },
        repos: { list: vi.fn().mockResolvedValue([]) }
      } as unknown as PreloadApi
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<PluginSkillMappingDialog plugin={plugin} onClose={vi.fn()} />)
      await Promise.resolve()
    })
    const save = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Save'
    )
    await act(async () => save?.dispatchEvent(new MouseEvent('click', { bubbles: true })))

    expect(setSkillMapping).toHaveBeenCalledWith({
      pluginKey: plugin.pluginKey,
      contributionPath: 'skills',
      targets: [{ scope: 'user', providers: ['codex', 'claude'] }]
    })
  })
})

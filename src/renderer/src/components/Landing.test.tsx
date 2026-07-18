// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Landing from './Landing'

const openModal = vi.fn()
const appState = {
  repos: [] as { id: string; kind: 'git'; path: string; displayName: string }[],
  openModal
}

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: typeof appState) => unknown) => selector(appState)
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({})
}))

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

vi.mock('@/hooks/useShortcutLabel', () => ({
  useShortcutKeyDetails: () => ({
    keys: ['⌘', 'N'],
    doubleTap: false
  })
}))

vi.mock('./landing-preflight-issues', () => ({
  getLandingPreflightIssues: () => [],
  hasGitHubBackedProject: () => false
}))

describe('Landing agent creation surface', () => {
  beforeEach(() => {
    openModal.mockReset()
    appState.repos = []
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        preflight: {
          check: vi.fn().mockResolvedValue({})
        }
      }
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('keeps workspace creation and project setup keyboard-accessible with no projects', async () => {
    const user = userEvent.setup()
    render(<Landing />)

    expect(screen.getByRole('heading', { name: 'Start an agent' })).toBeInTheDocument()
    expect(screen.queryByText('Build with agents')).not.toBeInTheDocument()
    expect(screen.queryByText('Previous workspace')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /GitHub/i })).not.toBeInTheDocument()

    await user.tab()
    expect(screen.getByRole('button', { name: /New agent workspace/i })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(openModal).toHaveBeenCalledWith('new-workspace-composer', {
      telemetrySource: 'unknown'
    })

    await user.tab()
    expect(screen.getByRole('button', { name: 'Add project' })).toHaveFocus()
    await user.keyboard(' ')
    expect(openModal).toHaveBeenLastCalledWith('add-repo')
  })

  it('uses the same single creation surface when projects already exist', async () => {
    appState.repos = [
      {
        id: 'repo-1',
        kind: 'git',
        path: '/repo',
        displayName: 'Repo'
      }
    ]
    const user = userEvent.setup()
    render(<Landing />)

    expect(screen.getAllByRole('button')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: /New agent workspace/i }))

    expect(openModal).toHaveBeenCalledWith('new-workspace-composer', {
      telemetrySource: 'unknown'
    })
  })
})

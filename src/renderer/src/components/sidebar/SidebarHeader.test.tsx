// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import type { ReactNode } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  openModal: vi.fn(),
  openWorkspaceComposer: vi.fn()
}))

vi.mock('@/store', () => ({
  useAppStore: (
    selector: (state: { openModal: typeof mocks.openModal; repos: never[] }) => unknown
  ) => selector({ openModal: mocks.openModal, repos: [] })
}))

vi.mock('@/hooks/useShortcutLabel', () => ({
  useShortcutLabel: () => '⌘N'
}))

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('./SidebarWorkspaceOptionsMenu', () => ({
  default: () => null
}))

vi.mock('../contextual-tours/workspace-creation-tour-handoff', () => ({
  openWorkspaceCreationComposerWithTourHandoff: mocks.openWorkspaceComposer
}))

import SidebarHeader from './SidebarHeader'

describe('SidebarHeader', () => {
  afterEach(() => {
    cleanup()
    mocks.openModal.mockReset()
    mocks.openWorkspaceComposer.mockReset()
  })

  it('keeps new workspace creation keyboard-accessible with zero projects', async () => {
    const user = userEvent.setup()
    render(<SidebarHeader onWorkspaceBoardMenuOpenChange={vi.fn()} />)

    const createButton = screen.getByRole('button', { name: 'New workspace' })
    expect(createButton).toBeEnabled()

    createButton.focus()
    expect(createButton).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(mocks.openWorkspaceComposer).toHaveBeenCalledOnce()
  })

  it('keeps direct project setup available', async () => {
    const user = userEvent.setup()
    render(<SidebarHeader onWorkspaceBoardMenuOpenChange={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Add Project' }))

    expect(mocks.openModal).toHaveBeenCalledWith('add-repo')
  })
})

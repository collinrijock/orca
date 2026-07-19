/**
 * @vitest-environment happy-dom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TabBarCliPickerAgentSection, TabBarCliPickerFooter } from './TabBarCliPickerSections'

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenuItem: ({
    children,
    disabled,
    onSelect,
    ...props
  }: {
    children?: ReactNode
    disabled?: boolean
    onSelect?: (event: Event) => void
  }) => (
    <button
      {...props}
      disabled={disabled}
      onClick={() => onSelect?.(new Event('select', { cancelable: true }))}
    >
      {children}
    </button>
  ),
  DropdownMenuLabel: ({ children, ...props }: { children?: ReactNode; className?: string }) => (
    <div {...props}>{children}</div>
  ),
  DropdownMenuSeparator: (props: { className?: string }) => <hr {...props} />
}))

vi.mock('@/lib/agent-catalog', () => ({
  AgentIcon: ({ agent }: { agent: string }) => <span data-agent-icon={agent} />
}))

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

let container: HTMLDivElement
let root: Root

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
})

function mount(node: ReactNode): void {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(node))
}

describe('TabBarCliPickerSections', () => {
  it('renders rich detected CLI rows and marks the configured default', () => {
    mount(
      <TabBarCliPickerAgentSection
        agentOptions={[
          {
            agent: 'codex',
            aliases: ['codex'],
            command: 'codex-beta',
            isDefault: true,
            label: 'Codex'
          }
        ]}
        hasDetectedAgents
        isLoading={false}
        onLaunchAgent={vi.fn()}
      />
    )

    expect(container.textContent).toContain('Coding CLIs')
    expect(container.textContent).toContain('Codex')
    expect(container.textContent).toContain('codex-beta')
    expect(container.textContent).toContain('Default')
    expect(container.querySelector('[data-cli-picker-agent="codex"]')).not.toBeNull()
    const iconChip = container.querySelector('[data-agent-icon="codex"]')?.parentElement
    expect(iconChip?.className).toContain('bg-foreground/80')
    expect(iconChip?.className).toContain('dark:bg-foreground/10')
    expect(container.querySelector('code')?.className).toContain('group-focus:text-foreground')
    const sectionLabel = [...container.querySelectorAll('div')].find(
      (element) => element.textContent === 'Coding CLIs'
    )
    expect(sectionLabel?.className).toContain('text-muted-foreground')
    expect(sectionLabel?.className).not.toContain('text-muted-foreground/80')
  })

  it('distinguishes detection loading from no installed CLIs', () => {
    mount(
      <TabBarCliPickerAgentSection
        agentOptions={[]}
        hasDetectedAgents={false}
        isLoading
        onLaunchAgent={vi.fn()}
      />
    )
    expect(container.textContent).toContain('Looking for installed CLIs…')

    act(() => {
      root.render(
        <TabBarCliPickerAgentSection
          agentOptions={[]}
          hasDetectedAgents={false}
          isLoading={false}
          onLaunchAgent={vi.fn()}
        />
      )
    })
    expect(container.textContent).toContain('No installed CLIs found')

    act(() => {
      root.render(
        <TabBarCliPickerAgentSection
          agentOptions={[]}
          hasDetectedAgents
          isLoading={false}
          onLaunchAgent={vi.fn()}
        />
      )
    })
    expect(container.textContent).toContain('No enabled CLIs')
  })

  it('keeps refresh available in-place and opens CLI settings', () => {
    const onRefresh = vi.fn()
    const onOpenSettings = vi.fn()
    mount(
      <TabBarCliPickerFooter
        isRefreshing={false}
        onRefresh={onRefresh}
        onOpenSettings={onOpenSettings}
      />
    )

    const buttons = container.querySelectorAll('button')
    expect(buttons[0]?.parentElement?.className).toContain('flex-col')
    expect(buttons[0]?.className).toContain('text-muted-foreground')
    expect(buttons[0]?.className).not.toMatch(/opacity-(?!50)/)
    act(() => buttons[0]?.click())
    act(() => buttons[1]?.click())
    expect(onRefresh).toHaveBeenCalledOnce()
    expect(onOpenSettings).toHaveBeenCalledOnce()

    act(() =>
      root.render(
        <TabBarCliPickerFooter isRefreshing onRefresh={onRefresh} onOpenSettings={onOpenSettings} />
      )
    )
    expect(container.querySelector('button')?.disabled).toBe(true)
  })
})

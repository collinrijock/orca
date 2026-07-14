// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SkillFreshnessCheckButton } from './SkillFreshnessCheckButton'
import {
  consumeSkillFreshnessUpdateDialogRequest,
  subscribeSkillFreshnessUpdateDialog
} from './skill-freshness-update-dialog'

let root: Root | null = null
let container: HTMLDivElement | null = null

async function renderButton(): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(<SkillFreshnessCheckButton />)
  })
}

describe('SkillFreshnessCheckButton', () => {
  beforeEach(() => {
    consumeSkillFreshnessUpdateDialogRequest()
  })

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount())
    }
    root = null
    container?.remove()
    container = null
  })

  it('requests the update dialog when clicked', async () => {
    const listener = vi.fn()
    const unsubscribe = subscribeSkillFreshnessUpdateDialog(listener)
    await renderButton()

    const button = container?.querySelector('button')
    expect(button?.textContent).toContain('Check for skill updates')
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(listener).toHaveBeenCalledTimes(1)
    expect(consumeSkillFreshnessUpdateDialogRequest()).toBe(true)
    unsubscribe()
  })
})

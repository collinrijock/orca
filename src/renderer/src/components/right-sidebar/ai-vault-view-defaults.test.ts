import { describe, expect, it } from 'vitest'
import { AI_VAULT_AGENTS } from '../../../../shared/ai-vault-types'
import {
  countAiVaultViewAdjustments,
  DEFAULT_AI_VAULT_GROUP,
  DEFAULT_AI_VAULT_HIDE_EMPTY_SESSIONS,
  DEFAULT_AI_VAULT_SORT
} from './ai-vault-view-defaults'

describe('ai-vault-view-defaults', () => {
  it('shows empty sessions by default', () => {
    expect(DEFAULT_AI_VAULT_HIDE_EMPTY_SESSIONS).toBe(false)
  })

  it('counts zero adjustments for the default view', () => {
    expect(
      countAiVaultViewAdjustments({
        agents: [...AI_VAULT_AGENTS],
        sort: DEFAULT_AI_VAULT_SORT,
        group: DEFAULT_AI_VAULT_GROUP,
        hideEmptySessions: DEFAULT_AI_VAULT_HIDE_EMPTY_SESSIONS
      })
    ).toBe(0)
  })

  it('treats hiding empty sessions as an adjustment from the new default', () => {
    expect(
      countAiVaultViewAdjustments({
        agents: [...AI_VAULT_AGENTS],
        sort: DEFAULT_AI_VAULT_SORT,
        group: DEFAULT_AI_VAULT_GROUP,
        hideEmptySessions: true
      })
    ).toBe(1)
  })

  it('does not count showing empty sessions as an adjustment', () => {
    expect(
      countAiVaultViewAdjustments({
        agents: [...AI_VAULT_AGENTS],
        sort: DEFAULT_AI_VAULT_SORT,
        group: DEFAULT_AI_VAULT_GROUP,
        hideEmptySessions: false
      })
    ).toBe(0)
  })

  it('counts other non-default view options independently', () => {
    expect(
      countAiVaultViewAdjustments({
        agents: ['claude'],
        sort: 'created',
        group: 'agent',
        hideEmptySessions: true
      })
    ).toBe(4)
  })
})

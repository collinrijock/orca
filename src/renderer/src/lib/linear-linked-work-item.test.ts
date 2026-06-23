import { describe, expect, it } from 'vitest'

import type { LinearIssue } from '../../../shared/types'
import { buildLinearIssueLinkedWorkItem, isLinearLinkedWorkItem } from './linear-linked-work-item'

function makeIssue(patch: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: 'issue-1',
    identifier: 'ENG-123',
    title: 'Fix launch context handoff',
    description: 'Pass Linear issue details into the agent.',
    url: 'https://linear.app/acme/issue/ENG-123/fix-launch-context-handoff',
    state: { name: 'Todo', type: 'unstarted', color: '#999999' },
    team: { id: 'team-1', name: 'Engineering', key: 'ENG' },
    labels: [],
    labelIds: [],
    priority: 3,
    estimate: null,
    updatedAt: '2026-05-29T12:00:00.000Z',
    ...patch
  }
}

describe('buildLinearIssueLinkedWorkItem', () => {
  it('preserves Linear metadata with prompt-time source context', () => {
    const item = buildLinearIssueLinkedWorkItem(
      makeIssue({
        labels: ['frontend', 'launch'],
        subIssues: [
          {
            id: 'issue-2',
            identifier: 'ENG-124',
            title: 'Add launch tests',
            url: 'https://linear.app/acme/issue/ENG-124/add-launch-tests'
          }
        ]
      })
    )

    expect(item).toMatchObject({
      type: 'issue',
      provider: 'linear',
      number: 0,
      title: 'Fix launch context handoff',
      url: 'https://linear.app/acme/issue/ENG-123/fix-launch-context-handoff',
      linearIdentifier: 'ENG-123',
      linearOrganizationUrlKey: 'acme'
    })
    expect(item.linkedContext).toMatchObject({
      provider: 'linear',
      version: 1
    })
    expect(item.linkedContext?.renderedText).toContain('Linear issue context snapshot')
    expect(item.linkedContext?.renderedText).toContain('Title: Fix launch context handoff')
    expect(item.linkedContext?.renderedText).toContain('Pass Linear issue details into the agent.')
    expect(item.linkedContext?.renderedText).toContain('Labels: frontend, launch')
    expect(item.linkedContext?.renderedText).toContain(
      '- ENG-124 Add launch tests (https://linear.app/acme/issue/ENG-124/add-launch-tests)'
    )
  })

  it('carries the Linear workspace id when the issue has one', () => {
    const item = buildLinearIssueLinkedWorkItem(makeIssue({ workspaceId: 'ws-1' }))

    expect(item.linearWorkspaceId).toBe('ws-1')
  })
})

describe('isLinearLinkedWorkItem', () => {
  it('recognizes Linear-linked composer sources by identifier', () => {
    expect(isLinearLinkedWorkItem(buildLinearIssueLinkedWorkItem(makeIssue()))).toBe(true)
    expect(isLinearLinkedWorkItem({})).toBe(false)
    expect(isLinearLinkedWorkItem(null)).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { WorktreeCreate } from './worktree-schemas'

describe('worktree RPC schemas', () => {
  it('accepts a UUID mutation ID and rejects malformed IDs', () => {
    expect(
      WorktreeCreate.safeParse({
        repo: 'repo-1',
        clientMutationId: '7350e466-9f8e-427f-8d42-2c70c8d9f801'
      }).success
    ).toBe(true)
    expect(WorktreeCreate.safeParse({ repo: 'repo-1', clientMutationId: 'reused' }).success).toBe(
      false
    )
  })

  it('rejects invalid startup agent values', () => {
    const parsed = WorktreeCreate.safeParse({
      repo: 'repo-1',
      name: 'agent-startup',
      startupAgent: 'wat',
      startupPrompt: 'hi'
    })

    expect(parsed.success).toBe(false)
  })

  it('rejects startup prompts without startup agents', () => {
    const parsed = WorktreeCreate.safeParse({
      repo: 'repo-1',
      name: 'agent-startup',
      startupPrompt: 'hi'
    })

    expect(parsed.success).toBe(false)
  })
})

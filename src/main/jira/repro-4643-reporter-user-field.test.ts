/**
 * Repro for issue #4643 — Jira connector: can't create an issue; "Reporter is
 * required", free-text name never resolves (no accountId picker).
 *
 * This test PINS the CURRENT (buggy) behavior. It passes today while asserting
 * the WRONG result. Assertions tagged `BUG:` encode the defect; `CORRECT:`
 * comments describe what a fixed implementation would do.
 *
 * Root cause spans two real, imported product seams plus one unexported
 * renderer helper (documented, verified by reading):
 *
 *  1. main/jira/issues.ts `mapCreateField` maps a required Jira `reporter`
 *     (schema.type `user`) create-meta field with NO `allowedValues`. The
 *     renderer's create form keys its picker branch on `allowedValues?.length`
 *     (src/renderer/src/components/TaskPage.tsx:12565), so a user field falls to
 *     the plain <Input> branch (:12596) — there is NO user-search dropdown. The
 *     create form never calls `listAssignableUsers` at all.
 *
 *  2. The unexported renderer helper `buildJiraCreateFieldValue`
 *     (TaskPage.tsx:1031-1058) has no branch for `schema.type === 'user'`. Typed
 *     text (a name OR a pasted accountId) falls through to `return trimmed`
 *     (:1058), i.e. a BARE STRING.
 *
 *  3. main/jira/issues.ts `createIssue` forwards that custom field verbatim
 *     (issues.ts:485-490) — so the POST body sends `reporter: "<string>"`
 *     instead of the `reporter: { id: "<accountId>" }` object Jira Cloud
 *     requires, and the create is rejected ("reporter is required" / invalid).
 *
 * Compare updateIssue (issues.ts:539-550), which DOES wrap the assignee user as
 * `{ accountId }` — the create path simply lacks the equivalent user handling.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { JiraClientForSite } from './client'

const { clearTokenMock, getClientsMock, isAuthErrorMock, jiraRequestMock } = vi.hoisted(() => ({
  clearTokenMock: vi.fn(),
  getClientsMock: vi.fn(),
  isAuthErrorMock: vi.fn(),
  jiraRequestMock: vi.fn()
}))

vi.mock('./client', () => ({
  acquire: vi.fn().mockResolvedValue(undefined),
  release: vi.fn(),
  apiBasePath: (site: { authType?: string }) =>
    site.authType === 'server' ? '/rest/api/2' : '/rest/api/3',
  clearToken: (...args: unknown[]) => clearTokenMock(...args),
  getClients: (...args: unknown[]) => getClientsMock(...args),
  isAuthError: (...args: unknown[]) => isAuthErrorMock(...args),
  jiraRequest: (...args: unknown[]) => jiraRequestMock(...args)
}))

function makeEntry(id = 'site-1'): JiraClientForSite {
  return {
    site: {
      id,
      siteUrl: 'https://example.atlassian.net',
      email: 'ada@example.com',
      displayName: 'Example Jira',
      accountId: 'account-1'
    },
    authorization: 'Basic token'
  }
}

describe('issue #4643 — Jira create-issue reporter (user) field', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isAuthErrorMock.mockReturnValue(false)
    getClientsMock.mockReturnValue([makeEntry()])
  })

  it('maps a required reporter user field with NO allowedValues, so the form has no picker', async () => {
    // Real Jira Cloud createmeta for a required reporter: schema.type === 'user'
    // and no allowedValues (user fields never enumerate options — they must be
    // resolved via /user/assignable/search).
    jiraRequestMock.mockResolvedValueOnce({
      startAt: 0,
      maxResults: 100,
      total: 1,
      values: [
        {
          fieldId: 'reporter',
          name: 'Reporter',
          required: true,
          schema: { type: 'user', system: 'reporter' }
        }
      ]
    })

    const { listCreateFields } = await import('./issues')
    const fields = await listCreateFields('10000', '10001', 'site-1')
    const reporter = fields.find((field) => field.key === 'reporter')

    expect(reporter).toBeDefined()
    expect(reporter?.required).toBe(true)
    expect(reporter?.schema?.type).toBe('user')

    // BUG: no allowedValues → the create form (TaskPage.tsx:12565) renders a
    // plain free-text <Input> instead of a user-search picker. There is no
    // accountId dropdown, so the user cannot select a valid reporter.
    // CORRECT: the create form should detect schema.type === 'user' and render a
    // typeahead backed by jira.listAssignableUsers, submitting the accountId.
    expect(reporter?.allowedValues).toBeUndefined()
  })

  it('forwards a bare-string reporter verbatim instead of wrapping it as { id }', async () => {
    // The value below (a bare accountId string) is exactly what the renderer's
    // buildJiraCreateFieldValue produces for a user field: with no allowedValues
    // and schema.type 'user', typed/pasted text returns `trimmed`
    // (TaskPage.tsx:1058) — a plain string, not { id }.
    jiraRequestMock.mockResolvedValueOnce({
      id: 'issue-1',
      key: 'ALP-1',
      self: 'https://example.atlassian.net/rest/api/3/issue/issue-1'
    })

    const { createIssue } = await import('./issues')
    const result = await createIssue({
      siteId: 'site-1',
      projectId: '10000',
      issueTypeId: '10001',
      title: 'Fix Jira create',
      customFields: {
        // What the UI hands to createIssue for a pasted accountId.
        reporter: '5b10a2844c20165700ede21g'
      }
    })

    expect(result).toMatchObject({ ok: true, key: 'ALP-1' })

    const requestInit = jiraRequestMock.mock.calls[0][2] as { body: string }
    const sentFields = JSON.parse(requestInit.body).fields as Record<string, unknown>

    // BUG: reporter is sent as a bare string. Jira Cloud requires an object with
    // an accountId, so the real API responds with an error and the issue is
    // never created — the exact "Reporter is required" failure in #4643.
    // CORRECT: sentFields.reporter should equal { id: '5b10a2844c20165700ede21g' }.
    expect(sentFields.reporter).toBe('5b10a2844c20165700ede21g')
    expect(sentFields.reporter).not.toEqual({ id: '5b10a2844c20165700ede21g' })
  })
})

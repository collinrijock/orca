// Repro for issue #7732: GitLab pipeline job details never load in the Checks
// side panel ("No inline details are available for this check.").
//
// Root cause: gitLabPipelineJobsToPRChecks (src/shared/gitlab-pipeline-checks.ts)
// maps each GitLab job to a PRCheckDetail but DROPS the GitLab job id. It only
// carries name/status/conclusion/url and never sets any identifier the expand
// path can use to fetch the job trace. When a row is expanded, the panel routes
// to GitHub's getPRCheckDetails (which needs checkRunId/workflowRunId + owner/repo);
// a GitLab job has none, so it returns null and the detail never loads.
//
// This test IMPORTS THE REAL product mapping and PINS the buggy behavior: the
// mapped rows contain no GitLab job identifier. It passes today (bug present).
import { describe, expect, it } from 'vitest'
import { gitLabPipelineJobsToPRChecks } from './gitlab-pipeline-checks'
import type { GitLabPipelineJob } from './gitlab-types'
import type { PRCheckDetail } from './types'

describe('repro #7732: gitLabPipelineJobsToPRChecks drops the GitLab job id', () => {
  const jobs: GitLabPipelineJob[] = [
    {
      id: 42, // real GitLab job id — needed to fetch its trace via gl.jobTrace
      pipelineId: 7,
      name: 'Purchase API Component Tests',
      stage: 'Component Tests',
      status: 'failed',
      webUrl: 'https://gitlab.com/acme/orca/-/jobs/42',
      duration: 31
    }
  ]

  it('BUG: mapped check row carries no identifier to load GitLab job details', () => {
    const [row] = gitLabPipelineJobsToPRChecks(jobs)

    // The mapping preserves display fields correctly.
    expect(row.name).toBe('Component Tests: Purchase API Component Tests')
    expect(row.conclusion).toBe('failure')

    // BUG: the source job had id 42, but nothing on the mapped row can be used
    // to route to the GitLab job-trace backend. There is no gitlabJobId field,
    // and the GitHub-only routing keys are never set.
    // CORRECT behavior would carry the job id through, e.g.
    //   expect((row as { gitlabJobId?: number }).gitlabJobId).toBe(42)
    expect((row as { gitlabJobId?: number }).gitlabJobId).toBeUndefined()
    expect(row.checkRunId).toBeUndefined()
    expect(row.workflowRunId).toBeUndefined()

    // Consequence: PRCheckDetail exposes no numeric handle for this job at all.
    const numericHandles = (Object.values(row) as unknown[]).filter((v) => typeof v === 'number')
    expect(numericHandles).toEqual([]) // no id survives -> expand cannot fetch trace
  })

  it('documents the expand routing gap for a mapped GitLab row', () => {
    const [row] = gitLabPipelineJobsToPRChecks(jobs)

    // checks-panel-content.tsx requestCheckDetails routes expansion using
    // checkRunId / workflowRunId (GitHub handles) and hands off to the GitHub
    // getPRCheckDetails loader. A GitLab-mapped row has neither, so there is no
    // way to reach gitlab:jobTrace from here.
    const hasGitHubRoutingHandle = row.checkRunId !== undefined || row.workflowRunId !== undefined
    expect(hasGitHubRoutingHandle).toBe(false) // BUG: nothing to route on

    // Type-level check: PRCheckDetail has no GitLab job field to populate.
    const key: keyof PRCheckDetail = 'name'
    expect(key).toBe('name')
  })
})

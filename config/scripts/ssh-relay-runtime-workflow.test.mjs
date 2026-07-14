import { readFile } from 'node:fs/promises'

import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

const workflowUrl = new URL(
  '../../.github/workflows/ssh-relay-runtime-artifacts.yml',
  import.meta.url
)

describe('SSH relay runtime artifact workflow', () => {
  it('uses exact native runner labels and SHA-pinned actions without publication authority', async () => {
    const workflow = parse(await readFile(workflowUrl, 'utf8'))
    const job = workflow.jobs['build-posix-runtime']
    const matrix = job.strategy.matrix.include

    expect(matrix.map((entry) => [entry.runner, entry.tuple])).toEqual([
      ['ubuntu-24.04', 'linux-x64-glibc'],
      ['ubuntu-24.04-arm', 'linux-arm64-glibc'],
      ['macos-15-intel', 'darwin-x64'],
      ['macos-15', 'darwin-arm64']
    ])
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(job['timeout-minutes']).toBe(20)
    expect(job.steps[0].with.ref).toBe('${{ github.event.pull_request.head.sha || github.sha }}')
    for (const step of job.steps.filter((candidate) => candidate.uses)) {
      expect(step.uses).toMatch(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40}$/)
    }
  })

  it('uploads only archive and metadata evidence after executable verification', async () => {
    const source = await readFile(workflowUrl, 'utf8')
    const workflow = parse(source)
    const steps = workflow.jobs['build-posix-runtime'].steps
    const buildIndex = steps.findIndex(
      (step) => step.name === 'Build, inspect, and smoke exact runtime'
    )
    const uploadIndex = steps.findIndex(
      (step) => step.name === 'Upload unpublished artifact evidence'
    )

    expect(buildIndex).toBeGreaterThan(-1)
    expect(uploadIndex).toBeGreaterThan(buildIndex)
    expect(source).toContain('verify-ssh-relay-runtime.mjs')
    expect(source).toContain('ssh-relay-runtime-workflow.test.mjs')
    expect(source).toContain('pnpm install --frozen-lockfile --ignore-scripts')
    expect(source).toContain('--connect-timeout 20 --max-time 300 --retry 2')
    expect(source).toContain('mkdir -p "$(dirname "$output")"')
    expect(source).toContain('source_commit=$(git rev-parse HEAD)')
    expect(source).toContain('--git-commit "$source_commit"')
    expect(source).not.toContain('--git-commit "$GITHUB_SHA"')
    expect(source).toContain('cp "$output"/*.tar.xz')
    expect(steps[uploadIndex].with.path).toBe('runtime-evidence/${{ matrix.tuple }}/')
    expect(source).not.toMatch(/releases\/|gh release|contents:\s*write/i)
  })
})

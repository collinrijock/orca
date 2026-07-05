import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const FORBIDDEN_IMPORT_PATTERNS = [
  /from\s+['"]@(?:\/|renderer)/,
  /from\s+['"]react(?:-dom)?(?:['"]|\/)/,
  /from\s+['"]lucide-react['"]/,
  /from\s+['"]@radix-ui/,
  /from\s+['"]electron(?:['"]|\/)/,
  /from\s+['"](?:zustand|@tanstack\/react)/,
  /from\s+['"]node:/,
  // Bare Node built-ins (no `node:` prefix) must also stay out so the module
  // loads in the renderer bundle.
  /from\s+['"](?:fs|path|os|child_process|crypto|util|stream|events|http|https|net|worker_threads|module|process)(?:['"]|\/)/,
  /from\s+['"].*\/renderer\//
]

const FORBIDDEN_GLOBAL_PATTERNS = [
  /\bwindow\./,
  /\bdocument\./,
  /\bnavigator\./,
  /\blocalStorage\./
]

function workspaceListSourceFiles(): string[] {
  const directory = join(process.cwd(), 'src/shared/workspace-list')
  return readdirSync(directory)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .map((file) => join(directory, file))
}

describe('workspace-list shared module import boundary', () => {
  it('stays UI-free and runtime-agnostic', () => {
    const violations: string[] = []

    for (const file of workspaceListSourceFiles()) {
      const source = readFileSync(file, 'utf8')
      for (const pattern of [...FORBIDDEN_IMPORT_PATTERNS, ...FORBIDDEN_GLOBAL_PATTERNS]) {
        if (pattern.test(source)) {
          violations.push(`${file.replace(`${process.cwd()}/`, '')}: ${pattern}`)
        }
      }
    }

    expect(violations).toEqual([])
  })
})

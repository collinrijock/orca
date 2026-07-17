import { existsSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import type * as TypeScriptApi from 'typescript-api'
import { describe, expect, it } from 'vitest'

const ts = createRequire(import.meta.url)('typescript-api') as typeof TypeScriptApi

const RENDERER_ROOT = resolve(process.cwd(), 'src/renderer/src')
const SOURCE_SUFFIXES = ['.ts', '.tsx', '/index.ts', '/index.tsx'] as const

type ValueImportGraph = {
  files: Set<string>
  packages: Set<string>
}

function resolveSourceImport(importer: string, specifier: string): string | null {
  const base = specifier.startsWith('@/')
    ? join(RENDERER_ROOT, specifier.slice(2))
    : specifier.startsWith('.')
      ? resolve(dirname(importer), specifier)
      : null
  if (!base) {
    return null
  }
  const candidates = [base, ...SOURCE_SUFFIXES.map((suffix) => `${base}${suffix}`)]
  return (
    candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null
  )
}

function hasValueImport(statement: TypeScriptApi.ImportDeclaration): boolean {
  const clause = statement.importClause
  if (!clause) {
    return true
  }
  if (clause.isTypeOnly) {
    return false
  }
  if (clause.name || !clause.namedBindings || ts.isNamespaceImport(clause.namedBindings)) {
    return true
  }
  return clause.namedBindings.elements.some((element) => !element.isTypeOnly)
}

function valueSpecifiers(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    false,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
  const specifiers: string[] = []
  for (const statement of source.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      hasValueImport(statement)
    ) {
      specifiers.push(statement.moduleSpecifier.text)
    }
    if (
      ts.isExportDeclaration(statement) &&
      !statement.isTypeOnly &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      specifiers.push(statement.moduleSpecifier.text)
    }
  }
  return specifiers
}

function buildValueImportGraph(entry: string): ValueImportGraph {
  const graph: ValueImportGraph = { files: new Set(), packages: new Set() }
  const pending = [entry]
  while (pending.length > 0) {
    const file = pending.pop()!
    if (graph.files.has(file)) {
      continue
    }
    graph.files.add(file)
    for (const specifier of valueSpecifiers(file)) {
      const resolved = resolveSourceImport(file, specifier)
      if (resolved) {
        pending.push(resolved)
      } else if (!specifier.startsWith('.') && !specifier.startsWith('@/')) {
        graph.packages.add(specifier)
      }
    }
  }
  return graph
}

function relativeFiles(graph: ValueImportGraph): string[] {
  return [...graph.files].map((file) => file.slice(RENDERER_ROOT.length + 1))
}

describe('startup value-import boundaries', () => {
  it('keeps xterm, WebGL, and Markdown engines out of the App startup graph', () => {
    const graph = buildValueImportGraph(join(RENDERER_ROOT, 'App.tsx'))
    const files = relativeFiles(graph)

    expect([...graph.packages].filter((name) => name.startsWith('@xterm/'))).toEqual([])
    expect(graph.packages).not.toContain('react-markdown')
    expect(graph.packages).not.toContain('dompurify')
    expect(files.some((file) => file.includes('/pane-webgl-renderer'))).toBe(false)
    expect(files.some((file) => file.endsWith('/CommentMarkdown.tsx'))).toBe(false)
    expect(files.some((file) => file.endsWith('/LinearAgentSkillSetupDialog.tsx'))).toBe(false)
    expect(files.some((file) => file.endsWith('/OnboardingInlineCommandTerminal.tsx'))).toBe(false)
  })

  it('keeps startup color publication independent from live pane mutation', () => {
    const graph = buildValueImportGraph(
      join(RENDERER_ROOT, 'components/terminal-pane/terminal-startup-view-attributes.ts')
    )
    const files = relativeFiles(graph)

    expect(files.some((file) => file.includes('/pane-manager/'))).toBe(false)
    expect(files).not.toContain('components/terminal-pane/terminal-appearance.ts')
    expect([...graph.packages].filter((name) => name.startsWith('@xterm/'))).toEqual([])
  })
})

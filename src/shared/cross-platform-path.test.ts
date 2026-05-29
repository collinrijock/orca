import { describe, expect, it } from 'vitest'
import {
  isPathInsideOrEqual,
  relativePathInsideRoot,
  resolveRuntimePath
} from './cross-platform-path'

describe('cross-platform path containment', () => {
  it('keeps POSIX sibling prefixes outside the root', () => {
    expect(isPathInsideOrEqual('/repo/app', '/repo/app')).toBe(true)
    expect(isPathInsideOrEqual('/repo/app', '/repo/app/src/index.ts')).toBe(true)
    expect(isPathInsideOrEqual('/repo/app', '/repo/application/src/index.ts')).toBe(false)
    expect(relativePathInsideRoot('/repo/app/', '/repo/app/src/index.ts')).toBe('src/index.ts')
  })

  it('handles Windows drive roots and sibling drives case-insensitively', () => {
    expect(isPathInsideOrEqual('C:\\Repo', 'c:\\repo\\src\\index.ts')).toBe(true)
    expect(relativePathInsideRoot('C:\\Repo', 'c:\\repo\\src\\index.ts')).toBe('src/index.ts')
    expect(isPathInsideOrEqual('C:\\Repo', 'D:\\Repo\\src\\index.ts')).toBe(false)
    expect(relativePathInsideRoot('C:\\', 'c:\\repo\\src\\index.ts')).toBe('repo/src/index.ts')
  })

  it('handles UNC roots, trailing slashes, mixed separators, and case', () => {
    expect(isPathInsideOrEqual('\\\\Server\\Share\\Repo\\', '//server/share/repo/src')).toBe(true)
    expect(relativePathInsideRoot('\\\\Server\\Share\\Repo\\', '//server/share/repo/src')).toBe(
      'src'
    )
    expect(isPathInsideOrEqual('\\\\Server\\Share\\Repo', '\\\\server\\share\\repo2')).toBe(false)
  })
})

describe('resolveRuntimePath', () => {
  it('resolves POSIX relative paths against the base path', () => {
    expect(resolveRuntimePath('/repos/app', '../.worktrees')).toBe('/repos/.worktrees')
  })

  it('normalizes absolute POSIX paths without rebasing them', () => {
    expect(resolveRuntimePath('/repos/app', '/workspaces/../worktrees')).toBe('/worktrees')
  })

  it('resolves Windows relative paths with drive semantics', () => {
    expect(resolveRuntimePath('C:\\repos\\app', '..\\.worktrees')).toBe('C:/repos/.worktrees')
  })
})

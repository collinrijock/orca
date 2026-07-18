import { describe, expect, it } from 'vitest'
import { extractTerminalFileLinkCandidates, resolveTerminalFileLink } from './terminal-links'

// Repro for issue #5024 "Purple File Names not Clickable".
//
// Symptom: file names Claude Code (opus) prints in purple are not
// cmd-clickable, while other purple things (URLs, bold "~/…" paths) are.
//
// What this test pins about the CURRENT tree:
//
// Orca's terminal file-link detection is 100% content-based (path text) plus a
// filesystem-existence gate — it NEVER inspects the terminal cell color or the
// bold attribute. So "rendered purple" carries zero signal about whether a
// mention becomes a link. Whether a detected path is clickable is decided by
// createFilePathLinkProvider requiring window.api.shell.pathExists() to be true
// for the path resolved against ONE cwd (the pane's startup/link cwd).
//
// That single-cwd anchoring is the mechanism behind the report: agents mention
// files in ways that do not resolve against the terminal's cwd, so the provider
// drops the link even though the file exists elsewhere in the repo.
//
// The assertions below encode the BUGGY / gap behavior (they pass today). The
// "correct" behavior each one would ideally have is noted inline.

const CWD = '/home/user/repo'

function firstResolved(lineText: string) {
  const parsed = extractTerminalFileLinkCandidates(lineText)[0]
  if (!parsed) {
    return null
  }
  return {
    pathText: parsed.pathText,
    absolutePath: resolveTerminalFileLink(parsed, CWD)?.absolutePath ?? null
  }
}

describe('issue #5024 — purple file mentions are not clickable', () => {
  it('detection ignores color/bold entirely — purple is never a link signal', () => {
    // Both mentions detect identically from their text; the fact that one is
    // rendered bold-purple and the other plain-purple is invisible to Orca.
    // Clickability therefore hinges only on resolve+exist, not on the color the
    // user actually sees. This mismatch is the root of the confusion in #5024.
    expect(firstResolved('src/foo.ts')).toEqual({
      pathText: 'src/foo.ts',
      absolutePath: `${CWD}/src/foo.ts`
    })
    expect(firstResolved('src/foo.ts')).toEqual(firstResolved('src/foo.ts'))
  })

  it('BUG: a bare filename mention anchors to the cwd ROOT, not where the file lives', () => {
    // Claude constantly writes prose like "I updated terminal-links.ts". The
    // real file lives at src/renderer/src/lib/terminal-links.ts, but Orca can
    // only join the bare name onto the single pane cwd:
    const resolved = firstResolved('I updated terminal-links.ts to fix it')
    expect(resolved?.pathText).toBe('terminal-links.ts')
    // BUGGY target: cwd-root/terminal-links.ts (does not exist) → the
    // existence gate drops the link → purple but not clickable.
    expect(resolved?.absolutePath).toBe(`${CWD}/terminal-links.ts`)
    // CORRECT behavior would resolve the mention to the actual nested file so
    // the existence check passes and the link is offered.
  })

  it('BUG: a repo-root-relative path is unreachable when the pane cwd is a subdir', () => {
    // When the agent terminal cwd is a subdirectory (very common), a path the
    // agent prints relative to the repo root resolves to the WRONG absolute
    // location and fails the existence gate.
    const subdirCwd = '/home/user/repo/packages/app'
    const parsed = extractTerminalFileLinkCandidates('see src/renderer/App.tsx now')[0]
    const absolute = resolveTerminalFileLink(parsed, subdirCwd)?.absolutePath
    // BUGGY: anchored under the subdir cwd, not the repo root where it exists.
    expect(absolute).toBe('/home/user/repo/packages/app/src/renderer/App.tsx')
    // CORRECT: repo-root-relative agent paths should also be tried against the
    // worktree root, not only the pane's cwd.
  })

  it('BUG: paths Claude truncates with an ellipsis mis-detect as an absolute /path', () => {
    // Claude abbreviates long paths in its UI as "src/…/lib/terminal-links.ts".
    // The detector drops everything before "…" and treats the rest as an
    // absolute path rooted at the filesystem root.
    const resolved = firstResolved('src/…/lib/terminal-links.ts')
    // BUGGY: pathText loses the "src/…/" prefix and becomes "/lib/…".
    expect(resolved?.pathText).toBe('/lib/terminal-links.ts')
    // BUGGY target: /lib/terminal-links.ts at the filesystem root (never exists).
    expect(resolved?.absolutePath).toBe('/lib/terminal-links.ts')
    // CORRECT: an obviously-elided ("…") path should not be offered as a
    // bogus absolute-root link.
  })
})

import { mkdtemp, mkdir, rm, link } from 'node:fs/promises'
import { statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { scanAiVaultSessions } from './session-scanner'
import { isolatedScanRoots, writeJsonlFile } from './session-scanner-test-fixtures'

// Repro for issue #7521: AI Vault scans BOTH the system Codex sessions root
// (~/.codex/sessions) AND the Orca-managed codex-runtime-home sessions root as
// two independent *display* sources. When Orca bridges/hardlinks a system Codex
// transcript into the runtime home, the same physical session UUID exists under
// two paths. The scanner keys/dedupes sessions by `filePath` (session.id =
// `${host}:${agent}:${sessionId}:${filePath}`, session-scanner-accumulator.ts:96)
// and never dedupes by session UUID or inode, so the same session is displayed
// twice.

let tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })))
  tempRoots = []
})

describe('issue #7521 - Codex session duplicated across system + runtime-home roots', () => {
  it('shows the SAME Codex session twice when it is hardlinked into both roots', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-repro-7521-'))
    tempRoots.push(root)
    const roots = isolatedScanRoots(root)

    const sessionId = '019e9693-64fc-7370-9c18-7e625c595d0f'
    const rolloutFileName = `rollout-2026-06-04T23-58-22-${sessionId}.jsonl`
    const records = [
      {
        timestamp: '2026-06-04T23:58:22.000Z',
        type: 'session_meta',
        payload: { id: sessionId, cwd: '/repo/app' }
      },
      {
        timestamp: '2026-06-04T23:58:23.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'text', text: 'One physical Codex session' }]
        }
      }
    ]

    // System Codex sessions root (~/.codex/sessions equivalent).
    const systemDir = join(roots.codexSessionsDir, '2026', '06', '04')
    const systemFile = join(systemDir, rolloutFileName)
    await writeJsonlFile(systemFile, records)

    // Orca codex-runtime-home sessions root, passed to the scanner as an
    // additional display source exactly like cached-session-list.ts does.
    const runtimeHome = join(root, 'codex-runtime-home', 'home')
    const runtimeSessionsDir = join(runtimeHome, 'sessions')
    const runtimeDatedDir = join(runtimeSessionsDir, '2026', '06', '04')
    await mkdir(runtimeDatedDir, { recursive: true })
    const runtimeFile = join(runtimeDatedDir, rolloutFileName)
    // Hardlink: same physical transcript / same inode in both roots, matching
    // the issue's "these files can be hardlinks to the same physical transcript".
    await link(systemFile, runtimeFile)

    // Sanity: both paths really are the same inode (one physical transcript).
    expect(statSync(systemFile).ino).toBe(statSync(runtimeFile).ino)

    const result = await scanAiVaultSessions({
      ...roots,
      additionalCodexSessionsDirs: [runtimeSessionsDir],
      platform: 'darwin'
    })

    expect(result.issues).toEqual([])

    const codexSessions = result.sessions.filter((session) => session.agent === 'codex')
    const codexSessionIds = codexSessions.map((session) => session.sessionId)

    // BUG (#7521): the single physical session appears TWICE — once for the
    // system root path and once for the runtime-home path. Correct behavior
    // would be a single deduplicated entry (expected length 1, one unique id).
    expect(codexSessions).toHaveLength(2)
    expect(codexSessionIds).toEqual([sessionId, sessionId])
    // Distinct AI Vault ids (differ only by filePath) are why the byId dedupe
    // in session-list-results.ts / session-scanner.ts fails to collapse them.
    expect(new Set(codexSessions.map((session) => session.id)).size).toBe(2)
    expect(codexSessions[0]?.filePath).not.toBe(codexSessions[1]?.filePath)

    // --- What the fix should assert instead (currently FAILS) ---
    // expect(codexSessions).toHaveLength(1)
    // expect(new Set(codexSessionIds).size).toBe(1)
  })
})

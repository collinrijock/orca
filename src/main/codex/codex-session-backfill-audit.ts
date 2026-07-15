import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

export type CodexSessionBackfillAuditWriter = (record: Record<string, unknown>) => Promise<void>

export function createCodexSessionBackfillAuditWriter(
  auditLogPath: string
): CodexSessionBackfillAuditWriter {
  let auditDirectoryReady: Promise<string | undefined> | undefined
  return async (record): Promise<void> => {
    try {
      auditDirectoryReady ??= mkdir(dirname(auditLogPath), { recursive: true })
      await auditDirectoryReady
      await appendFile(
        auditLogPath,
        `${JSON.stringify({ at: new Date().toISOString(), ...record })}\n`,
        { encoding: 'utf-8' }
      )
    } catch (error) {
      // Why: the audit trail is diagnostics; losing a line must not fail the
      // backfill or leave a half-linked tree unrecorded in the summary counts.
      console.warn('[codex-session-backfill] Failed to append audit record:', error)
    }
  }
}

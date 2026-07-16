import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

export type CodexSessionBackfillAuditWriter = (record: Record<string, unknown>) => Promise<void>

export function createCodexSessionBackfillAuditWriter(
  auditLogPath: string
): CodexSessionBackfillAuditWriter {
  let auditDirectoryReady: Promise<string | undefined> | undefined
  const appendRecord = async (serializedRecord: string): Promise<void> => {
    auditDirectoryReady ??= mkdir(dirname(auditLogPath), { recursive: true }).catch(
      (error: unknown) => {
        auditDirectoryReady = undefined
        throw error
      }
    )
    await auditDirectoryReady
    await appendFile(auditLogPath, serializedRecord, { encoding: 'utf-8' })
  }
  return async (record): Promise<void> => {
    const serializedRecord = `${JSON.stringify({ at: new Date().toISOString(), ...record })}\n`
    try {
      await appendRecord(serializedRecord)
      return
    } catch {
      // Why: the heal consumes this ledger as its work queue. Retry the same
      // record once so a transient mkdir/write failure cannot omit a session.
    }
    try {
      await appendRecord(serializedRecord)
    } catch (error) {
      // Why: a published hardlink/copy may already be in use, so persistent
      // ledger failure is reported but cannot safely roll back the backfill.
      console.warn('[codex-session-backfill] Failed to append audit record:', error)
    }
  }
}

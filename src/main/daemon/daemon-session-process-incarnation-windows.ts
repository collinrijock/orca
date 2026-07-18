import type {
  ProcessIncarnationObservation,
  ProcessIncarnationProbeDependencies,
  ProcessIncarnationProbeResult
} from './daemon-session-process-incarnation'

const WINDOWS_BATCH_SIZE = 256
const PROCESS_QUERY_TIMEOUT_MS = 3_000
const PROCESS_QUERY_MAX_BYTES = 1024 * 1024
const INVARIANT_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{7}))?Z$/

type WindowsIdentityRow = { pid: number; creationDate: string | null }

export async function probeWindowsProcessIncarnations(
  pids: number[],
  dependencies: ProcessIncarnationProbeDependencies
): Promise<ProcessIncarnationProbeResult> {
  const observations: ProcessIncarnationObservation[] = []
  let failed = false
  let externalProcessCount = 0
  for (let offset = 0; offset < pids.length; offset += WINDOWS_BATCH_SIZE) {
    const chunk = pids.slice(offset, offset + WINDOWS_BATCH_SIZE)
    externalProcessCount += 1
    try {
      const { stdout } = await dependencies.runCommand(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', createWindowsIdentityQuery(chunk)],
        {
          encoding: 'utf8',
          timeout: PROCESS_QUERY_TIMEOUT_MS,
          maxBuffer: PROCESS_QUERY_MAX_BYTES,
          windowsHide: true
        }
      )
      const rows = parseWindowsIdentityRows(stdout, new Set(chunk))
      if (rows === null) {
        failed = true
        observations.push(...chunk.map(unknownObservation))
      } else {
        observations.push(...projectWindowsRows(chunk, rows))
      }
    } catch {
      failed = true
      observations.push(...chunk.map(unknownObservation))
    }
  }
  return {
    status: failed ? 'failure' : 'success',
    reason: failed ? 'probe-failed' : 'none',
    observations,
    externalProcessCount
  }
}

export function parseWindowsIdentityRows(
  stdout: string,
  requestedPids: ReadonlySet<number>
): WindowsIdentityRow[] | null {
  const trimmed = stdout.trim()
  if (!trimmed) {
    return []
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return null
  }
  const values = Array.isArray(parsed) ? parsed : [parsed]
  const rows: WindowsIdentityRow[] = []
  for (const value of values) {
    if (!value || typeof value !== 'object') {
      return null
    }
    const raw = value as { ProcessId?: unknown; CreationDate?: unknown }
    const pid = numberFromJson(raw.ProcessId)
    if (pid === null || !requestedPids.has(pid)) {
      return null
    }
    if (raw.CreationDate !== null && typeof raw.CreationDate !== 'string') {
      return null
    }
    const creationDate = raw.CreationDate
    if (typeof creationDate === 'string' && !isInvariantCreationDate(creationDate)) {
      return null
    }
    rows.push({ pid, creationDate: creationDate ?? null })
  }
  return rows
}

function createWindowsIdentityQuery(pids: number[]): string {
  const filter = pids.map((pid) => `ProcessId = ${pid}`).join(' OR ')
  return (
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); ' +
    `$rows = @(Get-CimInstance -ClassName Win32_Process -Filter '${filter}' | ForEach-Object { ` +
    '$created = if ($null -eq $_.CreationDate) { $null } else { ' +
    "$_.CreationDate.ToUniversalTime().ToString('O', [System.Globalization.CultureInfo]::InvariantCulture) }; " +
    '[PSCustomObject]@{ ProcessId = [uint32]$_.ProcessId; CreationDate = $created } }); ' +
    'ConvertTo-Json -InputObject $rows -Compress'
  )
}

function projectWindowsRows(
  pids: number[],
  rows: WindowsIdentityRow[]
): ProcessIncarnationObservation[] {
  const rowsByPid = new Map<number, WindowsIdentityRow[]>()
  for (const row of rows) {
    const entries = rowsByPid.get(row.pid) ?? []
    entries.push(row)
    rowsByPid.set(row.pid, entries)
  }
  return pids.map((pid) => {
    const entries = rowsByPid.get(pid) ?? []
    if (entries.length > 1) {
      return { pid, state: 'ambiguous' }
    }
    if (entries.length === 0 || entries[0].creationDate === null) {
      return { pid, state: 'unknown' }
    }
    return { pid, state: 'observed', token: `win32:${entries[0].creationDate}` }
  })
}

function isInvariantCreationDate(value: string): boolean {
  const match = INVARIANT_DATE_PATTERN.exec(value)
  if (!match) {
    return false
  }
  const year = Number(match[1])
  const month = Number(match[2]) - 1
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  const date = new Date(Date.UTC(year, month, day, hour, minute, second))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second
  )
}

function numberFromJson(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number.NaN
  return Number.isSafeInteger(number) && number > 0 ? number : null
}

function unknownObservation(pid: number): ProcessIncarnationObservation {
  return { pid, state: 'unknown' }
}

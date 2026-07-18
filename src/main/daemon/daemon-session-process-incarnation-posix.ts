import type {
  ProcessIncarnationObservation,
  ProcessIncarnationProbeDependencies,
  ProcessIncarnationProbeResult
} from './daemon-session-process-incarnation'

const BOOT_ID_PATH = '/proc/sys/kernel/random/boot_id'
const BOOT_ID_MAX_BYTES = 128
const PROC_STAT_MAX_BYTES = 8 * 1024
const LINUX_READ_CONCURRENCY = 32
const PROCESS_QUERY_TIMEOUT_MS = 3_000
const PROCESS_QUERY_MAX_BYTES = 8 * 1024 * 1024
const BOOT_ID_PATTERN = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i
const DARWIN_ROW_PATTERN = /^\s*(\d+)(?:\s+(.*?))?\s*$/
const DARWIN_START_PATTERN =
  /^(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export async function probeLinuxProcessIncarnations(
  pids: number[],
  dependencies: ProcessIncarnationProbeDependencies
): Promise<ProcessIncarnationProbeResult> {
  let bootId: string
  try {
    bootId = (await dependencies.readBoundedFile(BOOT_ID_PATH, BOOT_ID_MAX_BYTES)).trim()
  } catch {
    return failedProbe(pids)
  }
  if (!BOOT_ID_PATTERN.test(bootId)) {
    return failedProbe(pids)
  }

  const observations: ProcessIncarnationObservation[] = pids.map((pid) => ({
    pid,
    state: 'unknown'
  }))
  let partialFailure = false
  let nextIndex = 0
  const readNext = async (): Promise<void> => {
    while (nextIndex < pids.length) {
      const index = nextIndex++
      const pid = pids[index]
      try {
        const stat = await dependencies.readBoundedFile(`/proc/${pid}/stat`, PROC_STAT_MAX_BYTES)
        const ticks = parseLinuxProcStartTicks(stat)
        if (ticks === null) {
          partialFailure = true
          observations[index] = { pid, state: 'unknown' }
        } else {
          observations[index] = {
            pid,
            state: 'observed',
            token: `linux:${bootId.toLowerCase()}:${ticks}`
          }
        }
      } catch (error) {
        if (isMissingProcessError(error)) {
          observations[index] = { pid, state: 'not-observed' }
        } else {
          partialFailure = true
          observations[index] = { pid, state: 'unknown' }
        }
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(LINUX_READ_CONCURRENCY, pids.length) }, () => readNext())
  )
  return {
    status: partialFailure ? 'failure' : 'success',
    reason: partialFailure ? 'probe-failed' : 'none',
    observations,
    externalProcessCount: 0
  }
}

export async function probeDarwinProcessIncarnations(
  pids: number[],
  dependencies: ProcessIncarnationProbeDependencies
): Promise<ProcessIncarnationProbeResult> {
  const captureStartedAt = dependencies.now()
  let stdout: string
  try {
    ;({ stdout } = await dependencies.runCommand('ps', ['-axo', 'pid=,lstart='], {
      encoding: 'utf8',
      timeout: PROCESS_QUERY_TIMEOUT_MS,
      maxBuffer: PROCESS_QUERY_MAX_BYTES,
      windowsHide: true,
      env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC0' }
    }))
  } catch {
    return failedProbe(pids, 1)
  }
  const captureEndedAt = dependencies.now()
  if (captureEndedAt < captureStartedAt) {
    return failedProbe(pids, 1)
  }
  return {
    status: 'success',
    reason: 'none',
    observations: parseDarwinProcessTable(stdout, pids, captureStartedAt, captureEndedAt),
    externalProcessCount: 1
  }
}

export function parseLinuxProcStartTicks(stat: string): string | null {
  const commandEnd = stat.lastIndexOf(')')
  if (commandEnd < 2 || stat[0] < '1' || stat[0] > '9') {
    return null
  }
  const fieldsFromState = stat
    .slice(commandEnd + 1)
    .trim()
    .split(/\s+/)
  const ticks = fieldsFromState[19]
  return ticks && /^\d+$/.test(ticks) ? ticks : null
}

export function parseDarwinProcessTable(
  stdout: string,
  pids: readonly number[],
  captureStartedAt: number,
  captureEndedAt: number
): ProcessIncarnationObservation[] {
  const requested = new Set(pids)
  const rows = new Map<number, ({ token: string; startedAt: number } | null)[]>()
  for (const line of stdout.split(/\r?\n/)) {
    const match = DARWIN_ROW_PATTERN.exec(line)
    if (!match) {
      continue
    }
    const pid = Number(match[1])
    if (!requested.has(pid)) {
      continue
    }
    const parsed = match[2] ? parseDarwinStart(match[2]) : null
    const entries = rows.get(pid) ?? []
    entries.push(parsed)
    rows.set(pid, entries)
  }
  const captureStartSecond = Math.floor(captureStartedAt / 1_000)
  const captureEndSecond = Math.floor(captureEndedAt / 1_000)
  return pids.map((pid) => {
    const entries = rows.get(pid) ?? []
    if (entries.length === 0) {
      return { pid, state: 'not-observed' }
    }
    if (entries.length > 1) {
      return { pid, state: 'ambiguous' }
    }
    const entry = entries[0]
    if (entry === null) {
      return { pid, state: 'unknown' }
    }
    const startedSecond = Math.floor(entry.startedAt / 1_000)
    if (startedSecond >= captureStartSecond && startedSecond <= captureEndSecond) {
      return { pid, state: 'ambiguous' }
    }
    return { pid, state: 'observed', token: entry.token }
  })
}

function parseDarwinStart(value: string): { token: string; startedAt: number } | null {
  const match = DARWIN_START_PATTERN.exec(value)
  if (!match) {
    return null
  }
  const month = MONTHS.indexOf(match[1])
  const day = Number(match[2])
  const hour = Number(match[3])
  const minute = Number(match[4])
  const second = Number(match[5])
  const year = Number(match[6])
  const startedAt = Date.UTC(year, month, day, hour, minute, second)
  const date = new Date(startedAt)
  if (
    month < 0 ||
    WEEKDAYS[date.getUTCDay()] !== value.slice(0, 3) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  ) {
    return null
  }
  return { token: `darwin:${date.toISOString()}`, startedAt }
}

function isMissingProcessError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return false
  }
  return error.code === 'ENOENT' || error.code === 'ESRCH'
}

function failedProbe(pids: number[], externalProcessCount = 0): ProcessIncarnationProbeResult {
  return {
    status: 'failure',
    reason: 'probe-failed',
    observations: pids.map((pid) => ({ pid, state: 'unknown' })),
    externalProcessCount
  }
}

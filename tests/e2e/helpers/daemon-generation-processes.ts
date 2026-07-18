import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const PROCESS_IDENTITY_TOLERANCE_MS = process.platform === 'win32' ? 2_000 : 1_100
const PROCESS_QUERY_TIMEOUT_MS = 3_000
const PROCESS_QUERY_MAX_BYTES = 8 * 1024 * 1024

const processQueryOptions = {
  encoding: 'utf8' as const,
  timeout: PROCESS_QUERY_TIMEOUT_MS,
  maxBuffer: PROCESS_QUERY_MAX_BYTES,
  windowsHide: true
}

export type RecordedProcessIdentity = {
  pid: number
  startedAtMs: number
}

type ProcessRow = RecordedProcessIdentity & {
  parentPid: number
}

export async function waitForCondition(
  description: string,
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 10_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() <= deadline) {
    if (await predicate()) {
      return
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 25)
      timer.unref?.()
    })
  }
  throw new Error(`Timed out waiting for ${description}`)
}

async function readWindowsProcessRows(): Promise<ProcessRow[]> {
  const command = [
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false);',
    '$rows = Get-CimInstance Win32_Process | ForEach-Object {',
    '  [PSCustomObject]@{',
    '    pid = [int]$_.ProcessId;',
    '    parentPid = [int]$_.ParentProcessId;',
    "    startedAt = if ($null -eq $_.CreationDate) { $null } else { $_.CreationDate.ToUniversalTime().ToString('O', [System.Globalization.CultureInfo]::InvariantCulture) }",
    '  }',
    '};',
    '$rows | ConvertTo-Json -Compress'
  ].join(' ')
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command],
    processQueryOptions
  )
  const parsed = JSON.parse(stdout || '[]') as
    | { pid?: unknown; parentPid?: unknown; startedAt?: unknown }
    | { pid?: unknown; parentPid?: unknown; startedAt?: unknown }[]
  const rows = Array.isArray(parsed) ? parsed : [parsed]
  return rows.flatMap((row) => {
    const pid = Number(row.pid)
    const parentPid = Number(row.parentPid)
    const startedAtMs = typeof row.startedAt === 'string' ? Date.parse(row.startedAt) : Number.NaN
    return Number.isInteger(pid) && Number.isInteger(parentPid) && Number.isFinite(startedAtMs)
      ? [{ pid, parentPid, startedAtMs }]
      : []
  })
}

async function readPosixProcessRows(): Promise<ProcessRow[]> {
  const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,ppid=,lstart='], {
    ...processQueryOptions,
    // Why: process-start identity must not change with the CI host's locale or timezone.
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC0' }
  })
  return stdout.split('\n').flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line)
    if (!match) {
      return []
    }
    const startedAtMs = Date.parse(`${match[3]} UTC`)
    return Number.isFinite(startedAtMs)
      ? [{ pid: Number(match[1]), parentPid: Number(match[2]), startedAtMs }]
      : []
  })
}

async function readProcessRows(): Promise<ProcessRow[]> {
  return process.platform === 'win32' ? readWindowsProcessRows() : readPosixProcessRows()
}

export async function recordProcessIdentity(pid: number): Promise<RecordedProcessIdentity> {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(`Cannot record invalid fixture pid ${pid}`)
  }
  const startedAtMs = (await readProcessRows()).find((row) => row.pid === pid)?.startedAtMs ?? null
  if (startedAtMs === null || startedAtMs === undefined) {
    throw new Error(`Could not record process-start identity for fixture pid ${pid}`)
  }
  return { pid, startedAtMs }
}

export async function processIdentityIsAlive(identity: RecordedProcessIdentity): Promise<boolean> {
  const rows = await readProcessRows()
  const current = rows.find((row) => row.pid === identity.pid)
  return (
    current !== undefined &&
    Math.abs(current.startedAtMs - identity.startedAtMs) <= PROCESS_IDENTITY_TOLERANCE_MS
  )
}

export async function readRecordedProcessCommandLine(
  identity: RecordedProcessIdentity
): Promise<string> {
  if (!(await processIdentityIsAlive(identity))) {
    throw new Error(`Fixture pid ${identity.pid} changed incarnation before command inspection`)
  }
  if (process.platform === 'win32') {
    const command = [
      `$row = Get-CimInstance Win32_Process -Filter "ProcessId = ${identity.pid}";`,
      'if ($null -ne $row) { [Console]::Out.Write($row.CommandLine) }'
    ].join(' ')
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command],
      processQueryOptions
    )
    return stdout
  }
  const { stdout } = await execFileAsync(
    'ps',
    ['-ww', '-p', String(identity.pid), '-o', 'command='],
    {
      ...processQueryOptions,
      env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC0' }
    }
  )
  return stdout.trim()
}

export async function recordProcessTree(
  root: RecordedProcessIdentity
): Promise<RecordedProcessIdentity[]> {
  const rows = await readProcessRows()
  const currentRoot = rows.find((row) => row.pid === root.pid)
  if (
    !currentRoot ||
    Math.abs(currentRoot.startedAtMs - root.startedAtMs) > PROCESS_IDENTITY_TOLERANCE_MS
  ) {
    throw new Error(`Fixture root pid ${root.pid} changed incarnation before tree capture`)
  }

  const childrenByParent = new Map<number, ProcessRow[]>()
  for (const row of rows) {
    const children = childrenByParent.get(row.parentPid) ?? []
    children.push(row)
    childrenByParent.set(row.parentPid, children)
  }
  const recorded: RecordedProcessIdentity[] = [root]
  const pending = [...(childrenByParent.get(root.pid) ?? [])]
  while (pending.length > 0) {
    const row = pending.pop()
    if (!row) {
      continue
    }
    recorded.push({ pid: row.pid, startedAtMs: row.startedAtMs })
    pending.push(...(childrenByParent.get(row.pid) ?? []))
  }
  return recorded
}

async function signalRecordedProcess(
  identity: RecordedProcessIdentity,
  signal: NodeJS.Signals
): Promise<void> {
  if (!(await processIdentityIsAlive(identity))) {
    return
  }
  try {
    if (process.platform === 'win32') {
      await execFileAsync('taskkill', ['/pid', String(identity.pid), '/f'], processQueryOptions)
    } else {
      process.kill(identity.pid, signal)
    }
  } catch {
    // A process may exit after identity validation but before the signal.
  }
}

export async function terminateRecordedTree(identities: RecordedProcessIdentity[]): Promise<void> {
  for (const identity of identities) {
    await signalRecordedProcess(identity, 'SIGTERM')
  }
  try {
    await waitForCondition(
      'recorded fixture process tree to exit after SIGTERM',
      async () => !(await anyRecordedProcessIsAlive(identities)),
      3_000
    )
  } catch {
    for (const identity of identities) {
      await signalRecordedProcess(identity, 'SIGKILL')
    }
  }
  await waitForCondition(
    'recorded fixture process tree to be absent',
    async () => !(await anyRecordedProcessIsAlive(identities)),
    5_000
  )
}

export async function anyRecordedProcessIsAlive(
  identities: RecordedProcessIdentity[]
): Promise<boolean> {
  for (const identity of identities) {
    if (await processIdentityIsAlive(identity)) {
      return true
    }
  }
  return false
}

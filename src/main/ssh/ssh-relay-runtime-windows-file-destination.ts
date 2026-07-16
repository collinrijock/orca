import { assertSafeRemotePathSegment, normalizeWindowsRemotePath } from './ssh-remote-platform'
import { powerShellCommand } from './ssh-remote-powershell'
import {
  openSshRelayRuntimeCommandFileDestination,
  type SshRelayRuntimeCommandFileChannel
} from './ssh-relay-runtime-command-file-destination'
import type { SshRelayRuntimeSourceDestination } from './ssh-relay-runtime-source-stream'

export type OpenSshRelayRuntimeWindowsFileDestinationOptions = Readonly<{
  remotePath: string
  expectedSize: number
  signal: AbortSignal
  openChannel: (command: string, signal: AbortSignal) => Promise<SshRelayRuntimeCommandFileChannel>
}>

const HEADER_MAGIC = Buffer.from('ORCARLY1', 'ascii')
const FIXED_HEADER_BYTES = 20
const MAXIMUM_PATH_BYTES = 32 * 1024
const PAYLOAD_BUFFER_BYTES = 64 * 1024

export const SSH_RELAY_RUNTIME_WINDOWS_FILE_DESTINATION_LIMITS = Object.freeze({
  maximumHeaderBytes: FIXED_HEADER_BYTES + MAXIMUM_PATH_BYTES,
  maximumPathBytes: MAXIMUM_PATH_BYTES,
  payloadBufferBytes: PAYLOAD_BUFFER_BYTES
})

const RECEIVER_SCRIPT = `
$ErrorActionPreference = 'Stop'
function Read-Exact([System.IO.Stream]$Stream, [byte[]]$Buffer, [int]$Count) {
  $offset = 0
  while ($offset -lt $Count) {
    $read = $Stream.Read($Buffer, $offset, $Count - $offset)
    if ($read -eq 0) { throw 'SSH relay runtime Windows receiver early EOF' }
    $offset += $read
  }
}
$inputStream = [Console]::OpenStandardInput()
$outputStream = $null
$ownsFile = $false
try {
  [byte[]]$header = New-Object byte[] ${FIXED_HEADER_BYTES}
  Read-Exact $inputStream $header ${FIXED_HEADER_BYTES}
  if ([Text.Encoding]::ASCII.GetString($header, 0, 8) -ne 'ORCARLY1') { throw 'bad header' }
  [uint32]$pathLength = [BitConverter]::ToUInt32($header, 8)
  [int64]$expectedSize = [BitConverter]::ToInt64($header, 12)
  if ($pathLength -eq 0 -or $pathLength -gt ${MAXIMUM_PATH_BYTES}) { throw 'bad path length' }
  if ($expectedSize -lt 0 -or $expectedSize -gt 9007199254740991) { throw 'bad size' }
  [byte[]]$pathBytes = New-Object byte[] ([int]$pathLength)
  Read-Exact $inputStream $pathBytes ([int]$pathLength)
  $utf8 = New-Object Text.UTF8Encoding($false, $true)
  $path = $utf8.GetString($pathBytes)
  if (-not [IO.Path]::IsPathRooted($path) -or $path.IndexOf([char]0) -ge 0) { throw 'bad path' }
  $outputStream = New-Object System.IO.FileStream($path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None, ${PAYLOAD_BUFFER_BYTES}, [IO.FileOptions]::SequentialScan)
  $ownsFile = $true
  [byte[]]$buffer = New-Object byte[] ${PAYLOAD_BUFFER_BYTES}
  [int64]$remaining = $expectedSize
  while ($remaining -gt 0) {
    $wanted = [int][Math]::Min([int64]$buffer.Length, $remaining)
    $read = $inputStream.Read($buffer, 0, $wanted)
    if ($read -eq 0) { throw 'SSH relay runtime Windows receiver early EOF' }
    $outputStream.Write($buffer, 0, $read)
    $remaining -= $read
  }
  if ($inputStream.ReadByte() -ne -1) { throw 'SSH relay runtime Windows receiver extra byte' }
  $outputStream.Flush()
  $outputStream.Dispose()
  $outputStream = $null
  $ownsFile = $false
} catch {
  try { if ($null -ne $outputStream) { $outputStream.Dispose() } } catch {}
  try { if ($ownsFile) { [IO.File]::Delete($path) } } catch {}
  throw 'SSH relay runtime Windows receiver failed'
}
`.trim()

const RECEIVER_COMMAND = powerShellCommand(RECEIVER_SCRIPT)

function normalizeRemotePath(remotePath: string): string {
  if (
    typeof remotePath !== 'string' ||
    remotePath === '' ||
    remotePath.includes('\0') ||
    remotePath.includes('\r') ||
    remotePath.includes('\n')
  ) {
    throw new Error('SSH relay runtime Windows file destination path is invalid')
  }
  const normalized = normalizeWindowsRemotePath(remotePath)
  const driveRooted = /^[A-Za-z]:\//u.test(normalized)
  const uncRooted = /^\/\/[^/]+\/[^/]+\//u.test(normalized)
  if ((!driveRooted && !uncRooted) || normalized.endsWith('/')) {
    throw new Error('SSH relay runtime Windows file destination path is invalid')
  }
  const segments = driveRooted ? normalized.slice(3).split('/') : normalized.slice(2).split('/')
  try {
    for (const segment of segments) {
      assertSafeRemotePathSegment(segment, 'windows')
    }
  } catch {
    throw new Error('SSH relay runtime Windows file destination path is invalid')
  }
  return normalized
}

function buildHeader(remotePath: string, expectedSize: number): Buffer {
  const pathBytes = Buffer.from(remotePath, 'utf8')
  if (pathBytes.length === 0 || pathBytes.length > MAXIMUM_PATH_BYTES) {
    throw new Error('SSH relay runtime Windows file destination path is invalid')
  }
  const header = Buffer.allocUnsafe(FIXED_HEADER_BYTES + pathBytes.length)
  HEADER_MAGIC.copy(header, 0)
  header.writeUInt32LE(pathBytes.length, 8)
  header.writeBigUInt64LE(BigInt(expectedSize), 12)
  pathBytes.copy(header, FIXED_HEADER_BYTES)
  return header
}

function validateOptions(options: OpenSshRelayRuntimeWindowsFileDestinationOptions): string {
  if (
    !options ||
    typeof options.openChannel !== 'function' ||
    !options.signal ||
    !Number.isSafeInteger(options.expectedSize) ||
    options.expectedSize < 0
  ) {
    throw new Error('SSH relay runtime Windows file destination input is invalid')
  }
  return normalizeRemotePath(options.remotePath)
}

export async function openSshRelayRuntimeWindowsFileDestination(
  options: OpenSshRelayRuntimeWindowsFileDestinationOptions
): Promise<SshRelayRuntimeSourceDestination> {
  const remotePath = validateOptions(options)
  const header = buildHeader(remotePath, options.expectedSize)
  const destination = await openSshRelayRuntimeCommandFileDestination({
    command: RECEIVER_COMMAND,
    fileKind: 'Windows',
    signal: options.signal,
    openChannel: options.openChannel
  })
  try {
    // Why: the receiver must authenticate framing before any source buffer can be borrowed.
    await destination.write(header)
    return destination
  } catch (error) {
    try {
      await destination.abort(error)
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'SSH relay runtime Windows file header cleanup failed'
      )
    }
    throw error
  }
}

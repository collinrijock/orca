import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'

import { create, Parser } from 'tar'

import { createSshRelayRuntimeZip, inspectSshRelayRuntimeZip } from './ssh-relay-runtime-zip.mjs'

const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024
const MAX_DIAGNOSTIC_BYTES = 64 * 1024
const XZ_TIMEOUT_MS = 5 * 60 * 1000

function archiveName(tuple, contentId) {
  const match = /^sha256:([0-9a-f]{64})$/.exec(contentId)
  if (!match) {
    throw new Error('Runtime content identity is not a SHA-256 digest')
  }
  const suffix = tuple.startsWith('win32-') ? 'zip' : 'tar.xz'
  return `orca-ssh-relay-runtime-v1-${tuple}-${match[1]}.${suffix}`
}

async function compressTar(tarPath, archivePath, signal) {
  const child = spawn(
    'xz',
    ['--compress', '--stdout', '--threads=1', '--check=crc64', '-9e', '--', tarPath],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, signal }
  )
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-MAX_DIAGNOSTIC_BYTES)
  })
  const completion = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, closeSignal) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`xz failed (${code ?? closeSignal ?? 'unknown'}): ${stderr.trim()}`))
      }
    })
  })
  try {
    await Promise.all([
      pipeline(child.stdout, createWriteStream(archivePath, { flags: 'wx', mode: 0o600 }), {
        signal
      }),
      completion
    ])
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill()
    }
    await completion.catch(() => {})
    throw error
  }
}

async function decompressArchive(archivePath, destination, signal) {
  const child = spawn('xz', ['--decompress', '--stdout', '--single-stream', '--', archivePath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    signal
  })
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-MAX_DIAGNOSTIC_BYTES)
  })
  const completion = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, closeSignal) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`xz failed (${code ?? closeSignal ?? 'unknown'}): ${stderr.trim()}`))
      }
    })
  })
  try {
    await Promise.all([pipeline(child.stdout, destination, { signal }), completion])
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill()
    }
    await completion.catch(() => {})
    throw error
  }
}

export async function createSshRelayRuntimeArchive({
  runtimeRoot,
  outputDirectory,
  identity,
  sourceDateEpoch,
  signal
}) {
  if (identity.tupleId.startsWith('win32-')) {
    return createSshRelayRuntimeZip({
      runtimeRoot,
      outputDirectory,
      identity,
      sourceDateEpoch,
      signal
    })
  }
  if (!Number.isSafeInteger(sourceDateEpoch) || sourceDateEpoch < 0) {
    throw new Error('Runtime archive SOURCE_DATE_EPOCH must be a non-negative safe integer')
  }
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'orca-runtime-tar-'))
  const tarPath = join(temporaryDirectory, 'runtime.tar')
  const name = archiveName(identity.tupleId, identity.contentId)
  const archivePath = join(outputDirectory, name)
  const effectiveSignal = signal ?? AbortSignal.timeout(XZ_TIMEOUT_MS)
  try {
    const paths = identity.entries.map((entry) => entry.path).sort()
    await create(
      {
        cwd: runtimeRoot,
        file: tarPath,
        portable: true,
        noPax: true,
        noDirRecurse: true,
        mtime: new Date(sourceDateEpoch * 1000)
      },
      paths
    )
    await compressTar(tarPath, archivePath, effectiveSignal)
    const metadata = await stat(archivePath)
    if (!metadata.isFile() || metadata.size === 0 || metadata.size > MAX_ARCHIVE_BYTES) {
      throw new Error('Runtime archive exceeds the release-manifest compressed-size limit')
    }
    const digest = createHash('sha256')
    for await (const chunk of createReadStream(archivePath)) {
      digest.update(chunk)
    }
    return {
      name,
      path: archivePath,
      size: metadata.size,
      sha256: `sha256:${digest.digest('hex')}`
    }
  } catch (error) {
    await rm(archivePath, { force: true })
    throw error
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}

export async function inspectSshRelayRuntimeArchive(archivePath, identity, { signal } = {}) {
  if (identity.tupleId.startsWith('win32-')) {
    return inspectSshRelayRuntimeZip(archivePath, identity, { signal })
  }
  const metadata = await stat(archivePath)
  if (!metadata.isFile() || metadata.size === 0 || metadata.size > MAX_ARCHIVE_BYTES) {
    throw new Error('Runtime archive exceeds the release-manifest compressed-size limit')
  }
  const expected = new Map(identity.entries.map((entry) => [entry.path, entry]))
  const seen = new Set()
  const pendingFiles = []
  const parser = new Parser({ strict: true })
  parser.on('entry', (entry) => {
    const path = entry.path.endsWith('/') ? entry.path.slice(0, -1) : entry.path
    const expectedEntry = expected.get(path)
    try {
      if (!expectedEntry || seen.has(path)) {
        throw new Error(`Runtime archive has extra or duplicate entry: ${path}`)
      }
      seen.add(path)
      const expectedType = expectedEntry.type === 'file' ? 'File' : 'Directory'
      if (entry.type !== expectedType || (entry.mode & 0o777) !== expectedEntry.mode) {
        throw new Error(`Runtime archive type or mode mismatch: ${path}`)
      }
      if (expectedEntry.type === 'file') {
        if (entry.size !== expectedEntry.size) {
          throw new Error(`Runtime archive size mismatch: ${path}`)
        }
        const digest = createHash('sha256')
        entry.on('data', (chunk) => digest.update(chunk))
        pendingFiles.push(
          new Promise((resolve, reject) => {
            entry.once('error', reject)
            entry.once('end', () => {
              const actual = `sha256:${digest.digest('hex')}`
              if (actual !== expectedEntry.sha256) {
                reject(new Error(`Runtime archive SHA-256 mismatch: ${path}`))
              } else {
                resolve()
              }
            })
          })
        )
      } else {
        entry.resume()
      }
    } catch (error) {
      parser.abort(error)
    }
  })
  await decompressArchive(archivePath, parser, signal ?? AbortSignal.timeout(XZ_TIMEOUT_MS))
  await Promise.all(pendingFiles)
  const missing = [...expected.keys()].filter((path) => !seen.has(path))
  if (missing.length > 0) {
    throw new Error(`Runtime archive is missing declared entry: ${missing[0]}`)
  }
  return {
    entries: seen.size,
    files: identity.entries.filter((entry) => entry.type === 'file').length,
    expandedBytes: identity.expandedSize
  }
}

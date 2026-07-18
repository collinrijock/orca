import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { DaemonGenerationRuntime } from './daemon-generation-fixtures'

export const V21_RELEASE_ASSET_NAME = 'Orca-1.4.139-arm64-mac.zip'
export const V21_RELEASE_SHA256 = 'e6c391dc05d03b196ad2a9a1ecba691e0edaa0c0cecb862447615580b026245c'
const V21_RELEASE_URL =
  'https://github.com/stablyai/orca/releases/download/v1.4.139/Orca-1.4.139-arm64-mac.zip'

async function sha256(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk as Buffer)
  }
  return hash.digest('hex')
}

async function downloadReleaseArchive(destination: string): Promise<void> {
  const response = await fetch(V21_RELEASE_URL)
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download v1.4.139 fixture: HTTP ${response.status}`)
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination))
}

function extractReleaseArchive(archivePath: string, extractionDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('ditto', ['-x', '-k', archivePath, extractionDir], (error) => {
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    })
  })
}

export async function prepareOfficialV21Fixture(
  runtime: DaemonGenerationRuntime
): Promise<
  { entryPath: string; executablePath: string; archivePath: string } | { skipReason: string }
> {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    return { skipReason: 'Official protocol-v21 release fixture is pinned for macOS arm64 only' }
  }
  const configuredArchive = process.env.ORCA_E2E_V21_RELEASE_ARCHIVE
  if (!configuredArchive && process.env.ORCA_E2E_DOWNLOAD_V21_FIXTURE !== '1') {
    return {
      skipReason:
        'Set ORCA_E2E_V21_RELEASE_ARCHIVE or ORCA_E2E_DOWNLOAD_V21_FIXTURE=1 to run the 191 MB release-boundary fixture'
    }
  }

  const archivePath = configuredArchive
    ? path.resolve(configuredArchive)
    : path.join(runtime.rootDir, V21_RELEASE_ASSET_NAME)
  if (!configuredArchive) {
    await downloadReleaseArchive(archivePath)
  }
  const digest = await sha256(archivePath)
  if (digest !== V21_RELEASE_SHA256) {
    throw new Error(`Protocol-v21 release fixture digest mismatch: ${digest}`)
  }

  const extractionDir = path.join(runtime.rootDir, 'official-v1.4.139')
  mkdirSync(extractionDir)
  await extractReleaseArchive(archivePath, extractionDir)
  const appRoot = path.join(extractionDir, 'Orca.app', 'Contents')
  const entryPath = path.join(
    appRoot,
    'Resources',
    'app.asar.unpacked',
    'out',
    'main',
    'daemon-entry.js'
  )
  const executablePath = path.join(
    appRoot,
    'Frameworks',
    'Orca Helper.app',
    'Contents',
    'MacOS',
    'Orca Helper'
  )
  if (!existsSync(entryPath) || !existsSync(executablePath)) {
    throw new Error('Verified v1.4.139 archive does not contain the expected daemon artifacts')
  }
  return { entryPath, executablePath, archivePath }
}

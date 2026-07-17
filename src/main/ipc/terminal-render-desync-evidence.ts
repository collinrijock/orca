import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { app, ipcMain } from 'electron'
import type {
  WriteTerminalRenderDesyncEvidenceArgs,
  WriteTerminalRenderDesyncEvidenceResult
} from '../../shared/terminal-render-desync-evidence'

const EVIDENCE_DIRECTORY = 'terminal-render-desync-evidence'
const MAX_PNG_DATA_URL_BYTES = 40 * 1024 * 1024
const CAPTURE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,120}$/
const PNG_DATA_URL_PREFIX = 'data:image/png;base64,'

export function registerTerminalRenderDesyncEvidenceHandler(): void {
  ipcMain.handle(
    'terminal:writeRenderDesyncEvidence',
    (_event, args: WriteTerminalRenderDesyncEvidenceArgs) =>
      writeTerminalRenderDesyncEvidence(app.getPath('userData'), args)
  )
}

export async function writeTerminalRenderDesyncEvidence(
  userDataPath: string,
  args: WriteTerminalRenderDesyncEvidenceArgs
): Promise<WriteTerminalRenderDesyncEvidenceResult> {
  if (!CAPTURE_ID_PATTERN.test(args.captureId)) {
    throw new Error('Invalid render-desync capture id')
  }
  if (args.phase !== 'corrupt' && args.phase !== 'healed') {
    throw new Error('Invalid render-desync evidence phase')
  }
  if (
    !args.pngDataUrl.startsWith(PNG_DATA_URL_PREFIX) ||
    args.pngDataUrl.length > MAX_PNG_DATA_URL_BYTES
  ) {
    throw new Error('Invalid render-desync PNG payload')
  }

  const png = Buffer.from(args.pngDataUrl.slice(PNG_DATA_URL_PREFIX.length), 'base64')
  const directory = path.join(userDataPath, EVIDENCE_DIRECTORY, args.captureId)
  const pngPath = path.join(directory, `${args.phase}.png`)
  const metadataPath = args.metadata ? path.join(directory, `${args.phase}.json`) : null

  // Why: captures contain terminal pixels and buffer text, so keep the
  // opt-in field evidence private to the local OS account by default.
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await writeFile(pngPath, png, { mode: 0o600 })
  if (metadataPath) {
    await writeFile(metadataPath, `${JSON.stringify(args.metadata, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    })
  }
  return { directory, pngPath, metadataPath }
}

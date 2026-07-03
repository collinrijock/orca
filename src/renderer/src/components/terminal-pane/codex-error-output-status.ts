type CodexErrorOutputStatusDetector = {
  observe: (data: string) => boolean
  reset: () => void
}

const ESC = String.fromCharCode(0x1b)
const BEL = String.fromCharCode(0x07)
const ANSI_ESCAPE_RE = new RegExp(
  `${ESC}(?:[@-Z\\\\-_]|\\[[0-?]*[ -/]*[@-~]|\\][^${BEL}]*(?:${BEL}|${ESC}\\\\))`,
  'g'
)
const INCOMPLETE_ANSI_ESCAPE_RE = new RegExp(
  `${ESC}(?:\\[[0-?]*[ -/]*|\\][^${BEL}${ESC}]*|\\S?)?$`,
  'g'
)
const CODEX_STREAM_DISCONNECTED_MARKER = 'stream disconnected before completion:'
const CODEX_STREAM_DISCONNECTED_CARRY_LENGTH = CODEX_STREAM_DISCONNECTED_MARKER.length - 1
const MAX_PENDING_STREAM_ERROR_LINE_LENGTH = 8_000
const RETRY_NOTICE_RE = /;\s*retrying\b/

function terminalControlMayAffectText(data: string): boolean {
  for (let index = 0; index < data.length; index += 1) {
    const code = data.charCodeAt(index)
    if (
      code === 0x0d ||
      code === 0x1b ||
      (code <= 0x1f && code !== 0x0a) ||
      (code >= 0x7f && code <= 0x9f)
    ) {
      return true
    }
  }
  return false
}

function stripTerminalControl(data: string): string {
  if (!terminalControlMayAffectText(data)) {
    return data
  }
  const withoutAnsi = data.replace(ANSI_ESCAPE_RE, '').replace(INCOMPLETE_ANSI_ESCAPE_RE, '')
  let output = ''
  for (let index = 0; index < withoutAnsi.length; index += 1) {
    const code = withoutAnsi.charCodeAt(index)
    if ((code <= 0x1f && code !== 0x0a && code !== 0x0d) || (code >= 0x7f && code <= 0x9f)) {
      continue
    }
    output += withoutAnsi[index]
  }
  return output
}

function appendMarkerCarry(carry: string, data: string): string {
  if (data.length >= CODEX_STREAM_DISCONNECTED_CARRY_LENGTH) {
    return data.slice(-CODEX_STREAM_DISCONNECTED_CARRY_LENGTH)
  }
  return (carry + data).slice(-CODEX_STREAM_DISCONNECTED_CARRY_LENGTH)
}

function updatePendingLine(pendingLine: string, data: string): string {
  return (pendingLine + data).slice(0, MAX_PENDING_STREAM_ERROR_LINE_LENGTH)
}

function findLineEnd(value: string, start: number): number {
  const carriageReturnIndex = value.indexOf('\r', start)
  const newlineIndex = value.indexOf('\n', start)
  if (carriageReturnIndex === -1) {
    return newlineIndex
  }
  if (newlineIndex === -1) {
    return carriageReturnIndex
  }
  return Math.min(carriageReturnIndex, newlineIndex)
}

function findLineStart(value: string, markerIndex: number): number {
  const previousCarriageReturn = value.lastIndexOf('\r', markerIndex)
  const previousNewline = value.lastIndexOf('\n', markerIndex)
  return Math.max(previousCarriageReturn, previousNewline) + 1
}

function isLikelyCodexFatalLinePrefix(prefix: string): boolean {
  const trimmed = prefix.trim()
  // Why: transient retry notices prefix the marker with words like
  // "stream error:"; Codex's fatal TUI cell only has whitespace/glyph chrome.
  return trimmed === '' || !/[A-Za-z0-9:/"'`|\\-]/.test(trimmed)
}

function normalizeStreamErrorLine(line: string): string | null {
  const strippedLine = stripTerminalControl(line)
  const markerIndex = strippedLine.indexOf(CODEX_STREAM_DISCONNECTED_MARKER)
  if (markerIndex === -1) {
    return null
  }
  if (!isLikelyCodexFatalLinePrefix(strippedLine.slice(0, markerIndex))) {
    return null
  }
  const message = strippedLine.slice(markerIndex).replace(/\s+/g, ' ').trim()
  if (!message || RETRY_NOTICE_RE.test(message)) {
    return null
  }
  return message
}

function findCompletedStreamErrorLine(rawText: string): {
  message: string | null
  pendingLine: string | null
} {
  let searchStart = 0
  while (searchStart < rawText.length) {
    const markerIndex = rawText.indexOf(CODEX_STREAM_DISCONNECTED_MARKER, searchStart)
    if (markerIndex === -1) {
      return { message: null, pendingLine: null }
    }
    const lineStart = findLineStart(rawText, markerIndex)
    const lineEnd = findLineEnd(rawText, markerIndex)
    if (lineEnd === -1) {
      const pendingLine = rawText.slice(lineStart)
      const message = normalizeStreamErrorLine(pendingLine)
      return message
        ? { message: null, pendingLine: pendingLine.slice(0, MAX_PENDING_STREAM_ERROR_LINE_LENGTH) }
        : { message: null, pendingLine: null }
    }

    const message = normalizeStreamErrorLine(rawText.slice(lineStart, lineEnd))
    if (message) {
      return { message, pendingLine: null }
    }
    searchStart = markerIndex + CODEX_STREAM_DISCONNECTED_MARKER.length
  }
  return { message: null, pendingLine: null }
}

export function createCodexErrorOutputStatusDetector(args: {
  onStreamError: (message: string) => void
}): CodexErrorOutputStatusDetector {
  let markerCarry = ''
  let pendingLine: string | null = null

  const reset = (): void => {
    markerCarry = ''
    pendingLine = null
  }

  return {
    observe(data: string): boolean {
      if (pendingLine !== null) {
        pendingLine = updatePendingLine(pendingLine, data)
        const lineEnd = findLineEnd(pendingLine, 0)
        if (lineEnd === -1 && pendingLine.length < MAX_PENDING_STREAM_ERROR_LINE_LENGTH) {
          markerCarry = appendMarkerCarry(markerCarry, data)
          return false
        }
        const message = normalizeStreamErrorLine(
          lineEnd === -1 ? pendingLine : pendingLine.slice(0, lineEnd)
        )
        pendingLine = null
        markerCarry = appendMarkerCarry(markerCarry, data)
        if (!message) {
          return false
        }
        args.onStreamError(message)
        return true
      }

      const seam = markerCarry + data.slice(0, CODEX_STREAM_DISCONNECTED_CARRY_LENGTH)
      if (
        !data.includes(CODEX_STREAM_DISCONNECTED_MARKER) &&
        !seam.includes(CODEX_STREAM_DISCONNECTED_MARKER)
      ) {
        markerCarry = appendMarkerCarry(markerCarry, data)
        return false
      }

      const rawText = data.includes(CODEX_STREAM_DISCONNECTED_MARKER) ? data : markerCarry + data
      const result = findCompletedStreamErrorLine(rawText)
      pendingLine = result.pendingLine
      markerCarry = appendMarkerCarry(markerCarry, data)
      if (!result.message) {
        return false
      }
      args.onStreamError(result.message)
      return true
    },
    reset
  }
}

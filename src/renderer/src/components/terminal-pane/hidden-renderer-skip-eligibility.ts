export type HiddenRendererSkipEligibility = {
  foreground: boolean
  canRestoreHiddenOutput: boolean
  startupRendererQueryWindowActive: boolean
  synchronizedOutputActive: boolean
  allowSynchronizedModelRestore?: boolean
  data: string
}

function isAllowedPlainHiddenOutputCodePoint(codePoint: number): boolean {
  if (codePoint === 0x09 || codePoint === 0x0a) {
    return true
  }
  if (codePoint >= 0x20 && codePoint <= 0x7e) {
    return true
  }
  // Why: hidden restore can safely replay ordinary single-cell Latin text from
  // headless state, while wide/combining/table glyph classes stay live.
  return (
    (codePoint >= 0x00a0 && codePoint <= 0x024f) || (codePoint >= 0x1e00 && codePoint <= 0x1eff)
  )
}

function findTitleOscEnd(data: string, startIndex: number): number | null {
  const command = data.charCodeAt(startIndex + 2)
  if (
    data.charCodeAt(startIndex) !== 0x1b ||
    data.charCodeAt(startIndex + 1) !== 0x5d ||
    (command !== 0x30 && command !== 0x31 && command !== 0x32) ||
    data.charCodeAt(startIndex + 3) !== 0x3b
  ) {
    return null
  }

  for (let index = startIndex + 4; index < data.length; index++) {
    const code = data.charCodeAt(index)
    if (code === 0x07) {
      return index + 1
    }
    if (code === 0x1b) {
      return data.charCodeAt(index + 1) === 0x5c ? index + 2 : null
    }
  }
  return null
}

function findSafeCsiEnd(data: string, startIndex: number): number | null {
  if (data.charCodeAt(startIndex) !== 0x1b || data.charCodeAt(startIndex + 1) !== 0x5b) {
    return null
  }

  for (let index = startIndex + 2; index < data.length; index++) {
    const code = data.charCodeAt(index)
    if (code < 0x40 || code > 0x7e) {
      continue
    }
    const body = data.slice(startIndex + 2, index)
    const final = data[index]
    if (isSafeHiddenRedrawCsi(body, final)) {
      return index + 1
    }
    return null
  }
  return null
}

function isSafeHiddenRedrawCsi(body: string, final: string): boolean {
  if (/[^0-9;?]/.test(body)) {
    return false
  }
  if (final === 'h' || final === 'l') {
    return body === '?2026' || body === '?25'
  }
  return (
    final === 'm' ||
    final === 'H' ||
    final === 'f' ||
    final === 'A' ||
    final === 'B' ||
    final === 'C' ||
    final === 'D' ||
    final === 'G' ||
    final === 'J' ||
    final === 'K'
  )
}

function containsOnlyRestorableHiddenOutput(data: string): boolean {
  for (let index = 0; index < data.length; ) {
    const code = data.charCodeAt(index)
    if (code === 0x1b) {
      const nextIndex = findTitleOscEnd(data, index) ?? findSafeCsiEnd(data, index)
      if (nextIndex === null) {
        return false
      }
      index = nextIndex
      continue
    }
    if (code === 0x0d) {
      if (data.charCodeAt(index + 1) !== 0x0a) {
        return false
      }
      index += 1
      continue
    }
    const codePoint = data.codePointAt(index)
    if (typeof codePoint !== 'number' || !isAllowedPlainHiddenOutputCodePoint(codePoint)) {
      return false
    }
    index += codePoint > 0xffff ? 2 : 1
  }
  return true
}

export function shouldSkipHiddenRendererOutput({
  foreground,
  canRestoreHiddenOutput,
  startupRendererQueryWindowActive,
  synchronizedOutputActive,
  allowSynchronizedModelRestore = false,
  data
}: HiddenRendererSkipEligibility): boolean {
  if (
    foreground ||
    !canRestoreHiddenOutput ||
    startupRendererQueryWindowActive ||
    data.length === 0
  ) {
    return false
  }
  if (synchronizedOutputActive) {
    // Why: release behavior keeps split DEC 2026 frames live. The override is
    // only for proving model-backed replay before shipping richer hidden skips.
    return allowSynchronizedModelRestore
  }
  return containsOnlyRestorableHiddenOutput(data)
}

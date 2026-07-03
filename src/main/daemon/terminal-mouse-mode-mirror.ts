import type { TerminalModes } from './types'

type MouseTrackingMode = NonNullable<TerminalModes['mouseTrackingMode']>

// Why: PTY/SSH chunks can split a long combined DECSET before the final h/l.
// Keep parser state far beyond normal mode lists while still bounding memory.
const PRIVATE_MODE_SCAN_TAIL_LIMIT = 4096

/**
 * Mirrors DECSET mouse-protocol/encoding state from the raw byte stream.
 * xterm's public modes API does not expose which mouse protocol is active,
 * so snapshots track it independently of the headless terminal; callers
 * must feed `scan()` the same bytes the terminal parsed, in order.
 */
export class TerminalMouseModeMirror {
  private scanTail = ''
  private trackingModeState: MouseTrackingMode = 'none'
  private sgrMouseModeState = false
  private sgrMousePixelsModeState = false

  get mouseTrackingMode(): MouseTrackingMode {
    return this.trackingModeState
  }

  get sgrMouseMode(): boolean {
    return this.sgrMouseModeState
  }

  get sgrMousePixelsMode(): boolean {
    return this.sgrMousePixelsModeState
  }

  scan(data: string): void {
    const input = this.scanTail + data
    this.scanTail = this.extractScanTail(input)
    // oxlint-disable-next-line no-control-regex -- terminal escape sequences require control chars
    const privateModeRe = /\x1bc|\x1b\[\?([0-9;]+)([hl])|\x9b\?([0-9;]+)([hl])/g
    let match: RegExpExecArray | null
    while ((match = privateModeRe.exec(input)) !== null) {
      if (match[0] === '\x1bc') {
        this.trackingModeState = 'none'
        this.sgrMouseModeState = false
        this.sgrMousePixelsModeState = false
        continue
      }
      const params = match[1] ?? match[3]
      const enabled = (match[2] ?? match[4]) === 'h'
      for (const rawParam of params.split(';')) {
        if (rawParam === '') {
          continue
        }
        const param = Number(rawParam)
        if (!Number.isInteger(param)) {
          continue
        }
        if (param === 9) {
          this.trackingModeState = enabled ? 'x10' : 'none'
        }
        if (param === 1000) {
          this.trackingModeState = enabled ? 'vt200' : 'none'
        }
        if (param === 1002) {
          this.trackingModeState = enabled ? 'drag' : 'none'
        }
        if (param === 1003) {
          this.trackingModeState = enabled ? 'any' : 'none'
        }
        if (param === 1006) {
          this.sgrMouseModeState = enabled
          this.sgrMousePixelsModeState = false
        }
        if (param === 1016) {
          this.sgrMouseModeState = false
          this.sgrMousePixelsModeState = enabled
        }
      }
    }
  }

  private extractScanTail(input: string): string {
    const start = Math.max(input.lastIndexOf('\x1b'), input.lastIndexOf('\x9b'))
    if (start === -1) {
      return ''
    }
    const tail = input.slice(start)
    if (tail.length > PRIVATE_MODE_SCAN_TAIL_LIMIT) {
      return ''
    }
    if (tail === '\x1b' || tail === '\x1b[' || tail === '\x9b') {
      return tail
    }
    if (tail.startsWith('\x1b[?')) {
      return this.isIncompleteParams(tail.slice(3)) ? tail : ''
    }
    if (tail.startsWith('\x9b?')) {
      return this.isIncompleteParams(tail.slice(2)) ? tail : ''
    }
    return ''
  }

  private isIncompleteParams(params: string): boolean {
    return /^[0-9;]*$/.test(params)
  }
}

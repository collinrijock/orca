import { extractLastOscTitle } from '../../shared/agent-detection'
import { parseFileUriPath } from './osc7-file-uri'
import { extractOscScanTail, scanOsc7Uris } from './osc7-uri-extraction'

const OSC_SCAN_TAIL_LIMIT = 4096

/** Mirror of the OSC sequences the emulator tracks outside xterm: OSC 7 cwd
 *  updates and OSC 0/2 titles. Keeps an unterminated-sequence tail so
 *  sequences split across PTY chunks still parse. Uses the bounded regex-free
 *  scanners so giant pasted chunks stay cheap. */
export class TerminalOscCwdTitleScanner {
  private scanTail = ''
  cwd: string | null = null
  lastTitle: string | null = null

  scan(data: string): void {
    const input = this.scanTail + data
    this.scanTail = extractOscScanTail(input, OSC_SCAN_TAIL_LIMIT)
    scanOsc7Uris(input, (uri) => {
      const parsed = parseFileUriPath(uri)
      if (parsed) {
        this.cwd = parsed
      }
    })
    const lastTitle = extractLastOscTitle(input)
    if (lastTitle !== null) {
      this.lastTitle = lastTitle
    }
  }
}

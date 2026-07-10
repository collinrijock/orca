export type PtyPendingOutputAppend = {
  data: string
  startSeq: number | undefined
  preservesSeq: boolean
  containsBackgroundOutput: boolean
}

export type PtyPendingOutputChunk = {
  data: string
  startSeq?: number
  containsBackgroundOutput?: boolean
  droppedBacklog?: boolean
}

const CHUNK_STORAGE_COMPACT_THRESHOLD = 1024

export class PtyPendingOutputBuffer {
  private chunks: string[] = []
  private headIndex = 0
  private headOffset = 0
  private totalChars = 0
  private startSeq: number | undefined
  private containsBackgroundOutput = false
  private droppedBacklog = false
  private readonly maxChars: number

  constructor(maxChars: number) {
    this.maxChars = Math.max(1, Math.floor(maxChars))
  }

  get length(): number {
    return this.totalChars
  }

  append({ data, startSeq, preservesSeq, containsBackgroundOutput }: PtyPendingOutputAppend): void {
    if (!data) {
      return
    }

    if (this.totalChars === 0) {
      this.startSeq = preservesSeq ? startSeq : undefined
    } else if (!preservesSeq) {
      // Why: transformed color-query output no longer maps one-to-one to raw
      // provider offsets, so later payloads must omit sequence metadata too.
      this.startSeq = undefined
    }
    this.containsBackgroundOutput ||= containsBackgroundOutput
    this.chunks.push(data)
    this.totalChars += data.length

    const overflowChars = this.totalChars - this.maxChars
    if (overflowChars <= 0) {
      return
    }
    this.consumePrefix(overflowChars, true)
    this.droppedBacklog = true
  }

  toString(): string {
    return this.readPrefix(this.totalChars)
  }

  takePrefix(maxChars: number): PtyPendingOutputChunk {
    const takeChars = Math.min(this.totalChars, Math.max(0, Math.floor(maxChars)))
    if (takeChars === 0) {
      return { data: '' }
    }

    const chunk: PtyPendingOutputChunk = {
      data: this.readPrefix(takeChars)
    }
    if (typeof this.startSeq === 'number') {
      chunk.startSeq = this.startSeq
    }
    if (this.containsBackgroundOutput) {
      chunk.containsBackgroundOutput = true
    }
    if (this.droppedBacklog) {
      chunk.droppedBacklog = true
      // Why: the renderer restore is idempotent; one trim should signal only
      // the first emitted chunk, matching the former string-buffer behavior.
      this.droppedBacklog = false
    }

    this.consumePrefix(takeChars, false)
    return chunk
  }

  takeAll(): PtyPendingOutputChunk {
    return this.takePrefix(this.totalChars)
  }

  private readPrefix(charCount: number): string {
    let remaining = charCount
    let index = this.headIndex
    let offset = this.headOffset
    const parts: string[] = []
    while (remaining > 0 && index < this.chunks.length) {
      const source = this.chunks[index]
      const available = source.length - offset
      const take = Math.min(remaining, available)
      parts.push(source.slice(offset, offset + take))
      remaining -= take
      index += 1
      offset = 0
    }
    return parts.length === 1 ? parts[0] : parts.join('')
  }

  private consumePrefix(charCount: number, releasePartialHead: boolean): void {
    let remaining = Math.min(charCount, this.totalChars)
    const consumedChars = remaining
    while (remaining > 0 && this.headIndex < this.chunks.length) {
      const source = this.chunks[this.headIndex]
      const available = source.length - this.headOffset
      if (remaining < available) {
        this.headOffset += remaining
        remaining = 0
        break
      }
      remaining -= available
      this.chunks[this.headIndex] = ''
      this.headIndex += 1
      this.headOffset = 0
    }

    this.totalChars -= consumedChars
    if (typeof this.startSeq === 'number') {
      this.startSeq += consumedChars
    }
    if (this.totalChars === 0) {
      this.resetEmptyStorage()
      return
    }

    if (releasePartialHead && this.headOffset > 0) {
      const source = this.chunks[this.headIndex]
      // Why: release an oversized provider chunk immediately, then wait until
      // half is dead so repeated cap trims stay amortized instead of re-slicing.
      if (source.length > this.maxChars || this.headOffset * 2 >= source.length) {
        this.chunks[this.headIndex] = source.slice(this.headOffset)
        this.headOffset = 0
      }
    }
    // Why: compact only after dead slots rival live slots; tiny provider chunks
    // must not recopy a full capped index every 1,024 appends.
    if (
      this.headIndex >= CHUNK_STORAGE_COMPACT_THRESHOLD &&
      this.headIndex >= this.chunks.length - this.headIndex
    ) {
      this.chunks = this.chunks.slice(this.headIndex)
      this.headIndex = 0
    }
  }

  private resetEmptyStorage(): void {
    this.chunks = []
    this.headIndex = 0
    this.headOffset = 0
    this.totalChars = 0
    this.startSeq = undefined
    this.containsBackgroundOutput = false
    this.droppedBacklog = false
  }
}

import { describe, expect, it } from 'vitest'
import { PtyPendingOutputBuffer } from './pty-pending-output-buffer'

describe('PTY pending output buffer', () => {
  it('avoids rebuilding a capped backlog across repeated small appends', () => {
    const maxChars = 2 * 1024 * 1024
    const chunk = 'x'.repeat(1024)
    const appendCount = 4096
    let previousLength = 0
    let previousLogicalCopiedChars = 0
    for (let index = 0; index < appendCount; index += 1) {
      previousLogicalCopiedChars += previousLength
      previousLength += chunk.length
      if (previousLength > maxChars) {
        previousLogicalCopiedChars += maxChars
        previousLength = maxChars
      }
    }
    expect(previousLogicalCopiedChars).toBe(10_736_369_664)

    const pending = new PtyPendingOutputBuffer(maxChars)
    for (let index = 0; index < appendCount; index += 1) {
      pending.append({
        data: chunk,
        startSeq: index * chunk.length,
        preservesSeq: true,
        containsBackgroundOutput: false
      })
    }

    expect(pending.length).toBe(maxChars)
    const drained = pending.takeAll()
    expect(drained).toMatchObject({
      startSeq: appendCount * chunk.length - maxChars,
      droppedBacklog: true
    })
    expect(drained.data).toHaveLength(maxChars)
    expect(drained.data).toBe('x'.repeat(maxChars))
    expect(pending.length).toBe(0)
  })

  it('advances through one oversized chunk without changing the newest tail', () => {
    const pending = new PtyPendingOutputBuffer(8)
    pending.append({
      data: 'abcdefghijkl',
      startSeq: 100,
      preservesSeq: true,
      containsBackgroundOutput: false
    })
    for (const [index, data] of ['m', 'n', 'o', 'p'].entries()) {
      pending.append({
        data,
        startSeq: 112 + index,
        preservesSeq: true,
        containsBackgroundOutput: false
      })
    }

    expect(pending.takeAll()).toEqual({
      data: 'ijklmnop',
      startSeq: 108,
      droppedBacklog: true
    })
  })

  it('drains across chunk boundaries while advancing sequence and metadata', () => {
    const pending = new PtyPendingOutputBuffer(64)
    pending.append({
      data: 'abc',
      startSeq: 10,
      preservesSeq: true,
      containsBackgroundOutput: false
    })
    pending.append({
      data: 'def',
      startSeq: 13,
      preservesSeq: true,
      containsBackgroundOutput: true
    })

    expect(pending.takePrefix(4)).toEqual({
      data: 'abcd',
      startSeq: 10,
      containsBackgroundOutput: true
    })
    expect(pending.takeAll()).toEqual({
      data: 'ef',
      startSeq: 14,
      containsBackgroundOutput: true
    })
  })

  it('retains the newest tail and emits the drop flag only once', () => {
    const pending = new PtyPendingOutputBuffer(5)
    pending.append({
      data: 'abc',
      startSeq: 100,
      preservesSeq: true,
      containsBackgroundOutput: false
    })
    pending.append({
      data: 'def',
      startSeq: 103,
      preservesSeq: true,
      containsBackgroundOutput: false
    })

    expect(pending.takePrefix(2)).toEqual({
      data: 'bc',
      startSeq: 101,
      droppedBacklog: true
    })
    expect(pending.takeAll()).toEqual({
      data: 'def',
      startSeq: 103
    })
  })

  it('drops sequence metadata after transformed output breaks raw offsets', () => {
    const pending = new PtyPendingOutputBuffer(5)
    pending.append({
      data: 'abc',
      startSeq: 10,
      preservesSeq: true,
      containsBackgroundOutput: false
    })
    pending.append({
      data: 'WXYZ',
      startSeq: undefined,
      preservesSeq: false,
      containsBackgroundOutput: false
    })

    expect(pending.takeAll()).toEqual({
      data: 'cWXYZ',
      droppedBacklog: true
    })
  })
})

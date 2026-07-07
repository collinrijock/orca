import { describe, expect, it } from 'vitest'

import {
  findRtlJoinRanges,
  isStrongRtlCodePoint,
  registerArabicShapingJoiner
} from './terminal-arabic-shaping-joiner'

describe('isStrongRtlCodePoint', () => {
  it('classifies Arabic and Hebrew letters as strong RTL', () => {
    expect(isStrongRtlCodePoint('م'.codePointAt(0)!)).toBe(true)
    expect(isStrongRtlCodePoint('ش'.codePointAt(0)!)).toBe(true)
    expect(isStrongRtlCodePoint('א'.codePointAt(0)!)).toBe(true)
    // Arabic presentation forms (legacy shaped codepoints).
    expect(isStrongRtlCodePoint(0xfe8d)).toBe(true)
    // Adlam (supplementary plane).
    expect(isStrongRtlCodePoint(0x1e900)).toBe(true)
  })

  it('does not classify Latin, box drawing, CJK, or emoji as RTL', () => {
    expect(isStrongRtlCodePoint('a'.codePointAt(0)!)).toBe(false)
    expect(isStrongRtlCodePoint('│'.codePointAt(0)!)).toBe(false)
    expect(isStrongRtlCodePoint('漢'.codePointAt(0)!)).toBe(false)
    expect(isStrongRtlCodePoint(0x1f600)).toBe(false)
  })
})

describe('findRtlJoinRanges', () => {
  it('returns no ranges for plain ASCII text', () => {
    expect(findRtlJoinRanges('ls -la | grep foo && echo done')).toEqual([])
  })

  it('returns no ranges for Latin-1/Cyrillic/Greek text below the RTL floor', () => {
    expect(findRtlJoinRanges('café привет αβγ')).toEqual([])
  })

  it('returns a fresh array on every call so xterm can merge into it safely', () => {
    const first = findRtlJoinRanges('plain')
    const second = findRtlJoinRanges('plain')
    expect(first).not.toBe(second)
  })

  it('joins a single Arabic word as one range', () => {
    const text = 'مرحبا'
    expect(findRtlJoinRanges(text)).toEqual([[0, text.length]])
  })

  it('joins a multi-word Arabic phrase across spaces as one range', () => {
    const text = 'مرحباً هذه مشكلة في اللغة العربية'
    expect(findRtlJoinRanges(text)).toEqual([[0, text.length]])
  })

  it('excludes leading and trailing neutrals from the range', () => {
    const text = '  مرحبا هذه  '
    expect(findRtlJoinRanges(text)).toEqual([[2, 11]])
  })

  it('stops the run at strong LTR words', () => {
    const text = 'مرحبا hello'
    expect(findRtlJoinRanges(text)).toEqual([[0, 5]])
  })

  it('does not pull an adjacent filename into the run', () => {
    const text = 'ملف test.txt'
    expect(findRtlJoinRanges(text)).toEqual([[0, 3]])
  })

  it('treats box-drawing characters as run breakers so TUI borders stay per-cell', () => {
    const text = '│ مرحبا بكم │'
    expect(findRtlJoinRanges(text)).toEqual([[2, 11]])
  })

  it('produces separate ranges for RTL runs split by LTR text', () => {
    const text = 'اهلا and שלום'
    expect(findRtlJoinRanges(text)).toEqual([
      [0, 4],
      [9, 13]
    ])
  })

  it('skips an isolated single RTL letter (already correct in isolated form)', () => {
    expect(findRtlJoinRanges('a م b')).toEqual([])
  })

  it('joins a letter with its combining tashkeel marks', () => {
    const text = 'مَ'
    expect(findRtlJoinRanges(text)).toEqual([[0, 2]])
  })

  it('tunnels through ASCII digits between Arabic words', () => {
    const text = 'صفحة 15 من 20 صفحة'
    expect(findRtlJoinRanges(text)).toEqual([[0, text.length]])
  })

  it('does not extend a run through trailing digits without a following RTL char', () => {
    const text = 'صفحة 15'
    expect(findRtlJoinRanges(text)).toEqual([[0, 4]])
  })

  it('joins Arabic-Indic digits and Arabic punctuation as part of the run', () => {
    const text = 'رقم ١٢٣، حسناً؟'
    expect(findRtlJoinRanges(text)).toEqual([[0, text.length]])
  })

  it('handles supplementary-plane RTL (Adlam) via surrogate pairs', () => {
    const text = '𞤀𞤣𞤤𞤢𞤥'
    expect(findRtlJoinRanges(text)).toEqual([[0, text.length]])
  })

  it('breaks runs on CJK and emoji above the scan floor', () => {
    const text = 'مرحبا漢بكم'
    expect(findRtlJoinRanges(text)).toEqual([
      [0, 5],
      [6, 9]
    ])
  })

  it('joins Hebrew words with niqqud points', () => {
    const text = 'שָׁלוֹם עוֹלָם'
    expect(findRtlJoinRanges(text)).toEqual([[0, text.length]])
  })
})

describe('registerArabicShapingJoiner', () => {
  it('registers the range finder and returns a cleanup that deregisters it', () => {
    let registered: ((text: string) => [number, number][]) | null = null
    let deregistered: number | null = null
    const terminal = {
      registerCharacterJoiner(handler: (text: string) => [number, number][]): number {
        registered = handler
        return 7
      },
      deregisterCharacterJoiner(joinerId: number): void {
        deregistered = joinerId
      }
    }
    const cleanup = registerArabicShapingJoiner(terminal)
    expect(registered).toBe(findRtlJoinRanges)
    expect(deregistered).toBeNull()

    // terminal.dispose() does not deregister joiners, so cleanup must.
    cleanup()
    expect(deregistered).toBe(7)
  })
})

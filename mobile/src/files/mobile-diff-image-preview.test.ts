import { describe, expect, it } from 'vitest'
import { mobileDiffImageDataUri } from './mobile-diff-image-preview'

describe('mobileDiffImageDataUri', () => {
  it('renders a modified image diff from the post-change bytes', () => {
    expect(
      mobileDiffImageDataUri({
        kind: 'binary',
        originalContent: 'b2xk',
        modifiedContent: 'bmV3',
        isImage: true,
        mimeType: 'image/png'
      })
    ).toBe('data:image/png;base64,bmV3')
  })

  it('renders an added image diff (no original) from the modified bytes', () => {
    expect(
      mobileDiffImageDataUri({
        kind: 'binary',
        originalContent: '',
        modifiedContent: 'bmV3',
        isImage: true,
        mimeType: 'image/png'
      })
    ).toBe('data:image/png;base64,bmV3')
  })

  it('falls back to the original bytes for a deleted image', () => {
    expect(
      mobileDiffImageDataUri({
        kind: 'binary',
        originalContent: 'b2xk',
        modifiedContent: '',
        isImage: true,
        mimeType: 'image/jpeg'
      })
    ).toBe('data:image/jpeg;base64,b2xk')
  })

  it('returns null for a non-previewable binary (no isImage/mimeType)', () => {
    expect(
      mobileDiffImageDataUri({
        kind: 'binary',
        originalContent: '',
        modifiedContent: 'AAAA'
      })
    ).toBeNull()
  })

  it('returns null when flagged as image but carrying no bytes', () => {
    expect(
      mobileDiffImageDataUri({
        kind: 'binary',
        originalContent: '',
        modifiedContent: '',
        isImage: true,
        mimeType: 'image/png'
      })
    ).toBeNull()
  })
})

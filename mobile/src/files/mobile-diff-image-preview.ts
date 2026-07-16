import { buildImageDataUri } from '../../../src/shared/image-data-uri'

// A git.diff result for a binary file. The host (git.diff) already sends base64
// image bytes plus isImage/mimeType for previewable formats, so mobile can render
// image diffs instead of falling back to "Binary preview unavailable".
export type MobileBinaryDiffResult = {
  kind: 'binary'
  originalContent?: string
  modifiedContent?: string
  isImage?: boolean
  mimeType?: string
}

// Builds a data URI for a binary image diff, preferring the modified (post-change)
// bytes and falling back to the original for deletions. Returns null for
// non-previewable binaries, which stay "Binary preview unavailable".
export function mobileDiffImageDataUri(result: MobileBinaryDiffResult): string | null {
  if (result.isImage !== true) {
    return null
  }
  return buildImageDataUri(result.mimeType, result.modifiedContent || result.originalContent || '')
}

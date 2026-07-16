import { buildImageDataUri } from '../../../src/shared/image-data-uri'

// A git.diff result for a binary file. The host (git.diff) already sends base64
// image bytes plus isImage/mimeType for previewable formats, so mobile can render
// image diffs instead of falling back to "Binary preview unavailable". The
// originalIsBinary/modifiedIsBinary flags tell a deletion (modified side absent)
// apart from a modify whose bytes the host couldn't inline (relay/size-capped).
export type MobileBinaryDiffResult = {
  kind: 'binary'
  originalContent?: string
  modifiedContent?: string
  originalIsBinary?: boolean
  modifiedIsBinary?: boolean
  isImage?: boolean
  mimeType?: string
}

// Builds a data URI for a binary image diff, preferring the modified (post-change)
// bytes. Only falls back to the original for a genuine deletion — when the modified
// side is absent (not binary). Returns null for non-previewable binaries and when
// the modified side IS a binary image but arrives empty (e.g. a relay working-tree
// read or a >size-cap file), since showing the pre-change image there would be
// silently stale rather than the current content.
export function mobileDiffImageDataUri(result: MobileBinaryDiffResult): string | null {
  if (result.isImage !== true) {
    return null
  }
  const modified = result.modifiedContent || ''
  if (modified) {
    return buildImageDataUri(result.mimeType, modified)
  }
  if (result.modifiedIsBinary === true) {
    return null
  }
  return buildImageDataUri(result.mimeType, result.originalContent || '')
}

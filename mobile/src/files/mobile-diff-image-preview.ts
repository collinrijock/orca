import { buildImageDataUri } from '../../../src/shared/image-data-uri'

// originalIsBinary/modifiedIsBinary distinguish a genuine deletion from a modify
// whose bytes the host couldn't inline (relay/size-capped).
export type MobileBinaryDiffResult = {
  kind: 'binary'
  originalContent?: string
  modifiedContent?: string
  originalIsBinary?: boolean
  modifiedIsBinary?: boolean
  isImage?: boolean
  mimeType?: string
}

// Falls back to the original bytes only for a genuine deletion; a size-capped/relay
// modify returns null instead of the stale pre-change image.
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

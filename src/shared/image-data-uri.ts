// Builds an inline `data:` URI for base64 image bytes, shared by the desktop
// editor ImageViewer and the mobile file preview so both decode images the same
// way. Strips whitespace from the payload (base64 from git diffs and SSH streams
// can arrive line-wrapped) and returns null when there is nothing an <img>/RN
// <Image> can show — empty content or a non-image mime such as application/pdf.
export function buildImageDataUri(
  mimeType: string | undefined,
  base64Content: string
): string | null {
  if (!mimeType || mimeType === 'application/pdf') {
    return null
  }
  const cleaned = base64Content.replace(/\s/g, '')
  if (!cleaned) {
    return null
  }
  return `data:${mimeType};base64,${cleaned}`
}

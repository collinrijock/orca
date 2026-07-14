export const SSH_RELAY_MAX_RELATIVE_PATH_BYTES = 240
export const SSH_RELAY_MAX_PATH_DEPTH = 32

const PORTABLE_PATH = /^[A-Za-z0-9._@+/-]+$/
const WINDOWS_DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i

export function assertSafeSshRelayArtifactPath(relativePath: string): void {
  const fail = (reason: string): never => {
    throw new Error(`Unsafe artifact path "${relativePath}": ${reason}`)
  }

  if (
    !relativePath ||
    Buffer.byteLength(relativePath, 'utf8') > SSH_RELAY_MAX_RELATIVE_PATH_BYTES
  ) {
    fail('empty or over the byte limit')
  }
  if (!PORTABLE_PATH.test(relativePath)) {
    fail('contains non-portable characters or separators')
  }
  if (relativePath.startsWith('/') || relativePath.startsWith('//')) {
    fail('absolute and UNC paths are forbidden')
  }

  const segments = relativePath.split('/')
  if (segments.length > SSH_RELAY_MAX_PATH_DEPTH) {
    fail('nesting depth exceeds the limit')
  }
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..') {
      fail('empty and dot segments are forbidden')
    }
    if (segment.endsWith('.') || segment.endsWith(' ')) {
      fail('Windows-trimmed suffix is forbidden')
    }
    if (WINDOWS_DEVICE_NAME.test(segment)) {
      fail('Windows device name is forbidden')
    }
  }
}

export function foldSshRelayArtifactPath(relativePath: string): string {
  return relativePath.toLowerCase()
}

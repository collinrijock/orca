import { createHash } from 'node:crypto'
import { canonicalizeCapabilitySet } from './plugin-capabilities'
import type { PluginManifest } from './plugin-manifest'

/**
 * Consent covers both the declared host capabilities and whether the plugin
 * executes trusted Node code. A panel-only update that adds `main` crosses a
 * trust boundary even when its capability list is unchanged.
 */
export function canonicalizePluginConsent(
  manifest: Pick<PluginManifest, 'capabilities' | 'main'>
): string {
  const capabilities = canonicalizeCapabilitySet(manifest.capabilities)
  // Preserve the original capability-only digest for panel/content plugins,
  // while making the trusted Node tier a domain-separated fingerprint.
  return manifest.main === undefined ? capabilities : `${capabilities}\0trusted-node-worker`
}

export function fingerprintPluginConsent(
  manifest: Pick<PluginManifest, 'capabilities' | 'main'>
): string {
  return `sha256-${createHash('sha256').update(canonicalizePluginConsent(manifest)).digest('base64')}`
}

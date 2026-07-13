import { createReadStream } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { PluginManifest } from '../../shared/plugins/plugin-manifest'

export type PluginArtifactValidationResult = { ok: true } | { ok: false; error: string }

export const PLUGIN_PANEL_ENTRY_MAX_BYTES = 10 * 1024 * 1024
export const PLUGIN_WORKER_ENTRY_MAX_BYTES = 50 * 1024 * 1024
const PLUGIN_ICON_MAX_BYTES = 2 * 1024 * 1024

function declaredArtifactPaths(
  manifest: PluginManifest
): { label: string; path: string; maxBytes: number }[] {
  return [
    ...(manifest.icon
      ? [{ label: 'icon', path: manifest.icon, maxBytes: PLUGIN_ICON_MAX_BYTES }]
      : []),
    ...(manifest.main
      ? [
          {
            label: 'worker entry',
            path: manifest.main,
            maxBytes: PLUGIN_WORKER_ENTRY_MAX_BYTES
          }
        ]
      : []),
    ...manifest.contributes.panels.map((panel) => ({
      label: `panel "${panel.id}" entry`,
      path: panel.entry,
      maxBytes: PLUGIN_PANEL_ENTRY_MAX_BYTES
    }))
  ]
}

export async function resolveContainedPluginArtifact(
  rootDir: string,
  relativePath: string,
  maxBytes = PLUGIN_WORKER_ENTRY_MAX_BYTES
): Promise<string> {
  const rootReal = await realpath(resolve(rootDir))
  return resolveArtifactFromRealRoot(rootDir, rootReal, relativePath, maxBytes)
}

export async function readContainedPluginArtifactText(
  rootDir: string,
  relativePath: string,
  maxBytes: number
): Promise<string> {
  const artifact = await resolveContainedPluginArtifact(rootDir, relativePath, maxBytes)
  const chunks: Buffer[] = []
  let totalBytes = 0
  for await (const chunk of createReadStream(artifact)) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    totalBytes += bytes.byteLength
    if (totalBytes > maxBytes) {
      throw new Error(`exceeds the ${maxBytes}-byte artifact limit`)
    }
    chunks.push(bytes)
  }
  return Buffer.concat(chunks, totalBytes).toString('utf8')
}

async function resolveArtifactFromRealRoot(
  rootDir: string,
  rootReal: string,
  relativePath: string,
  maxBytes: number
): Promise<string> {
  const artifactReal = await realpath(resolve(rootDir, ...relativePath.split(/[\\/]/)))
  const fromRoot = relative(rootReal, artifactReal)
  if (
    fromRoot.length === 0 ||
    isAbsolute(fromRoot) ||
    fromRoot === '..' ||
    fromRoot.startsWith(`..${sep}`)
  ) {
    throw new Error('resolves outside the plugin directory')
  }
  const artifactStat = await stat(artifactReal)
  if (!artifactStat.isFile()) {
    throw new Error('is not a regular file')
  }
  if (artifactStat.size > maxBytes) {
    throw new Error(`exceeds the ${maxBytes}-byte artifact limit`)
  }
  return artifactReal
}

/** Presence and containment checks are bounded by the manifest's declared artifacts. */
export async function validateDeclaredPluginArtifacts(
  rootDir: string,
  manifest: PluginManifest
): Promise<PluginArtifactValidationResult> {
  const artifacts = declaredArtifactPaths(manifest)
  if (artifacts.length === 0) {
    return { ok: true }
  }
  const seen = new Set<string>()
  let rootReal: string
  try {
    rootReal = await realpath(resolve(rootDir))
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  for (const artifact of artifacts) {
    if (seen.has(artifact.path)) {
      continue
    }
    seen.add(artifact.path)
    try {
      await resolveArtifactFromRealRoot(rootDir, rootReal, artifact.path, artifact.maxBytes)
    } catch (error) {
      return {
        ok: false,
        error: `${artifact.label} ${artifact.path}: ${error instanceof Error ? error.message : String(error)}`
      }
    }
  }
  return { ok: true }
}

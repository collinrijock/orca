import { TextDecoder } from 'node:util'
import type { ValidDiscoveredPlugin } from './plugin-discovery'
import type { PluginService } from './plugin-service'
import { readPluginTreeSnapshot, type PluginTreeSnapshot } from './plugin-content-hash'
import { PLUGIN_SKILL_MARKDOWN_MAX_BYTES } from './plugin-skill-package-reader'
import type {
  PluginConsentPreviewRequest,
  PluginConsentPreviewResult,
  PluginSkillConsentPreview
} from '../../shared/plugins/plugin-consent-preview'

const utf8Decoder = new TextDecoder('utf-8', { fatal: true })
const PLUGIN_SKILL_CONSENT_PREVIEW_LIMIT = 128
const PLUGIN_SKILL_CONSENT_PREVIEW_MAX_BYTES = 4 * 1024 * 1024

function normalizeSnapshotPath(path: string): string {
  return path.replaceAll('\\', '/')
}

function parentSnapshotPath(path: string): string {
  const separator = path.lastIndexOf('/')
  return separator < 0 ? '' : path.slice(0, separator)
}

function snapshotBasename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

export function readPluginSkillConsentPreviewsFromSnapshot(
  plugin: ValidDiscoveredPlugin,
  snapshot: PluginTreeSnapshot
): PluginSkillConsentPreview[] {
  const previews: PluginSkillConsentPreview[] = []
  let totalBytes = 0
  const files = new Map(snapshot.files.map((file) => [file.relativePath, file.content]))
  for (const contribution of plugin.manifest.contributes.skills) {
    const contributionPath = normalizeSnapshotPath(contribution.path)
    const directInstruction = files.get(`${contributionPath}/SKILL.md`)
    const packagePaths = directInstruction
      ? [contributionPath]
      : snapshot.directories.filter(
          (directory) => parentSnapshotPath(directory) === contributionPath
        )
    if (packagePaths.length === 0) {
      throw new Error(`skill contribution ${contribution.path} contains no skill packages`)
    }
    for (const packagePath of packagePaths) {
      if (previews.length >= PLUGIN_SKILL_CONSENT_PREVIEW_LIMIT) {
        throw new Error(
          `plugin skill consent preview exceeds the ${PLUGIN_SKILL_CONSENT_PREVIEW_LIMIT}-skill limit`
        )
      }
      const instructions = files.get(`${packagePath}/SKILL.md`)
      if (!instructions) {
        throw new Error(`skill package ${snapshotBasename(packagePath)} is missing SKILL.md`)
      }
      if (instructions.byteLength > PLUGIN_SKILL_MARKDOWN_MAX_BYTES) {
        throw new Error(`SKILL.md exceeds the ${PLUGIN_SKILL_MARKDOWN_MAX_BYTES}-byte limit`)
      }
      totalBytes += instructions.byteLength
      if (totalBytes > PLUGIN_SKILL_CONSENT_PREVIEW_MAX_BYTES) {
        throw new Error('plugin skill consent preview exceeds its 4 MiB limit')
      }
      previews.push({
        name: snapshotBasename(packagePath),
        instructions: utf8Decoder.decode(instructions)
      })
    }
  }
  return previews
}

const PREVIEW_UNAVAILABLE = {
  ok: false,
  error: 'plugin consent preview unavailable'
} as const

/** Loads only the exact plugin identity frozen by the consent dialog. */
export async function previewPluginConsent(
  service: PluginService,
  request: PluginConsentPreviewRequest,
  signal?: AbortSignal
): Promise<PluginConsentPreviewResult> {
  const plugin = service.findValidPlugin(request.pluginKey)
  if (!plugin || plugin.consentFingerprint !== request.reviewedFingerprint) {
    return PREVIEW_UNAVAILABLE
  }
  try {
    if (!plugin.consentContentHash) {
      return PREVIEW_UNAVAILABLE
    }
    // Why: the instructions shown for consent must come from the same buffers
    // used to prove the reviewed whole-tree identity, including mutable dev trees.
    const loaded = await readPluginTreeSnapshot(plugin.rootDir, signal)
    if (!loaded.ok) {
      return PREVIEW_UNAVAILABLE
    }
    const matchesReviewedContent =
      loaded.snapshot.hash === plugin.consentContentHash ||
      (plugin.consentContentHash.length === 32 &&
        loaded.snapshot.hash.startsWith(plugin.consentContentHash))
    if (!matchesReviewedContent) {
      return PREVIEW_UNAVAILABLE
    }
    const skills = readPluginSkillConsentPreviewsFromSnapshot(plugin, loaded.snapshot)
    const current = service.findValidPlugin(request.pluginKey)
    if (
      current !== plugin ||
      current.consentFingerprint !== request.reviewedFingerprint ||
      current.rootDir !== plugin.rootDir
    ) {
      return PREVIEW_UNAVAILABLE
    }
    return { ok: true, skills }
  } catch {
    // Why: package-reader errors can contain private desktop paths; callers
    // only need a fail-closed signal, not host filesystem detail.
    return PREVIEW_UNAVAILABLE
  }
}

import { TextDecoder } from 'node:util'
import type { ValidDiscoveredPlugin } from './plugin-discovery'
import {
  readPluginSkillInstruction,
  resolvePluginSkillPackageRoots
} from './plugin-skill-package-reader'

export type PluginSkillConsentPreview = {
  name: string
  instructions: string
}

const utf8Decoder = new TextDecoder('utf-8', { fatal: true })
const PLUGIN_SKILL_CONSENT_PREVIEW_LIMIT = 128
const PLUGIN_SKILL_CONSENT_PREVIEW_MAX_BYTES = 4 * 1024 * 1024

export async function readPluginSkillConsentPreviews(
  plugin: ValidDiscoveredPlugin
): Promise<PluginSkillConsentPreview[]> {
  const previews: PluginSkillConsentPreview[] = []
  let totalBytes = 0
  for (const contribution of plugin.manifest.contributes.skills) {
    const packages = await resolvePluginSkillPackageRoots(plugin.rootDir, contribution.path)
    for (const skill of packages) {
      if (previews.length >= PLUGIN_SKILL_CONSENT_PREVIEW_LIMIT) {
        throw new Error(
          `plugin skill consent preview exceeds the ${PLUGIN_SKILL_CONSENT_PREVIEW_LIMIT}-skill limit`
        )
      }
      const instructions = await readPluginSkillInstruction(skill)
      totalBytes += instructions.byteLength
      if (totalBytes > PLUGIN_SKILL_CONSENT_PREVIEW_MAX_BYTES) {
        throw new Error('plugin skill consent preview exceeds its 4 MiB limit')
      }
      previews.push({
        name: skill.skillName,
        instructions: utf8Decoder.decode(instructions)
      })
    }
  }
  return previews
}

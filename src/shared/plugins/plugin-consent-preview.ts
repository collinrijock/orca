import { z } from 'zod'
import { isQualifiedPluginKey } from './plugin-manifest'

export const pluginConsentPreviewRequestSchema = z
  .object({
    pluginKey: z.string().refine(isQualifiedPluginKey, 'invalid qualified plugin key'),
    reviewedFingerprint: z.string().min(1).max(256)
  })
  .strict()

export type PluginConsentPreviewRequest = z.infer<typeof pluginConsentPreviewRequestSchema>

export type PluginSkillConsentPreview = {
  name: string
  instructions: string
}

export type PluginConsentPreviewResult =
  | { ok: true; skills: PluginSkillConsentPreview[] }
  | { ok: false; error: 'plugin consent preview unavailable' }

import { z } from 'zod'
import {
  pluginCommandIdSchema,
  pluginIdSchema,
  pluginRelativeDirectorySchema,
  pluginRelativePathSchema
} from './plugin-manifest-fields'

export const PLUGIN_THEME_LIMIT = 64
export const PLUGIN_ICON_THEME_LIMIT = 32
export const PLUGIN_TERMINAL_THEME_LIMIT = 64
export const PLUGIN_LANGUAGE_PACK_LIMIT = 16
export const PLUGIN_SKILL_LIMIT = 128
export const PLUGIN_KEYBINDING_LIMIT = 256
export const PLUGIN_VM_RECIPE_LIMIT = 64
export const PLUGIN_AGENT_PROFILE_LIMIT = 64

export const pluginThemeContributionSchema = z
  .object({
    id: pluginIdSchema,
    label: z.string().min(1).max(128),
    path: pluginRelativePathSchema
  })
  .strict()

export const pluginIconThemeContributionSchema = z
  .object({
    id: pluginIdSchema,
    label: z.string().min(1).max(128).optional(),
    path: pluginRelativePathSchema
  })
  .strict()

export const pluginTerminalThemeContributionSchema = z
  .object({
    id: pluginIdSchema,
    label: z.string().min(1).max(128),
    path: pluginRelativePathSchema
  })
  .strict()

// Why: locale ids become i18next bundle keys and filenames. This bounded BCP
// 47 subset covers current community packs without accepting path syntax.
export const pluginLocaleIdSchema = z
  .string()
  .min(2)
  .max(35)
  .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/, 'must be a portable locale identifier')

export const pluginLanguagePackContributionSchema = z
  .object({
    locale: pluginLocaleIdSchema,
    path: pluginRelativePathSchema
  })
  .strict()

export const PLUGIN_SKILL_PROVIDERS = ['codex', 'claude', 'agent-skills'] as const

export const pluginSkillContributionSchema = z
  .object({
    path: pluginRelativeDirectorySchema,
    providers: z
      .array(z.enum(PLUGIN_SKILL_PROVIDERS))
      .min(1)
      .max(PLUGIN_SKILL_PROVIDERS.length)
      .optional()
  })
  .strict()

export const pluginKeybindingContributionSchema = z
  .object({
    command: pluginCommandIdSchema,
    key: z.string().min(1).max(128),
    when: z.string().min(1).max(256).optional()
  })
  .strict()

export const pluginVmRecipeContributionSchema = z
  .object({ path: pluginRelativePathSchema })
  .strict()

export const pluginAgentProfileContributionSchema = z
  .object({ path: pluginRelativePathSchema })
  .strict()

export type PluginThemeContribution = z.infer<typeof pluginThemeContributionSchema>
export type PluginIconThemeContribution = z.infer<typeof pluginIconThemeContributionSchema>
export type PluginTerminalThemeContribution = z.infer<typeof pluginTerminalThemeContributionSchema>
export type PluginLanguagePackContribution = z.infer<typeof pluginLanguagePackContributionSchema>
export type PluginSkillContribution = z.infer<typeof pluginSkillContributionSchema>
export type PluginKeybindingContribution = z.infer<typeof pluginKeybindingContributionSchema>
export type PluginVmRecipeContribution = z.infer<typeof pluginVmRecipeContributionSchema>
export type PluginAgentProfileContribution = z.infer<typeof pluginAgentProfileContributionSchema>

import { z } from 'zod'
import { PLUGIN_SKILL_PROVIDERS } from './plugin-content-pack-contributions'
import { pluginRelativeDirectorySchema } from './plugin-manifest-fields'

export const PLUGIN_SKILL_SCOPES = ['user', 'repository'] as const

export const pluginSkillMappingTargetSchema = z
  .object({
    scope: z.enum(PLUGIN_SKILL_SCOPES),
    repositoryPath: z.string().min(1).max(4096).optional(),
    providers: z.array(z.enum(PLUGIN_SKILL_PROVIDERS)).min(1).max(PLUGIN_SKILL_PROVIDERS.length)
  })
  .strict()
  .superRefine((target, ctx) => {
    if (target.scope === 'repository' && !target.repositoryPath) {
      ctx.addIssue({
        code: 'custom',
        path: ['repositoryPath'],
        message: 'required for repository scope'
      })
    }
    if (target.scope === 'user' && target.repositoryPath !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['repositoryPath'],
        message: 'not allowed for user scope'
      })
    }
    if (new Set(target.providers).size !== target.providers.length) {
      ctx.addIssue({ code: 'custom', path: ['providers'], message: 'providers must be unique' })
    }
  })

export const pluginSkillContributionMappingSchema = z
  .object({
    pluginKey: z.string().min(3).max(129),
    contributionPath: pluginRelativeDirectorySchema,
    targets: z.array(pluginSkillMappingTargetSchema).max(64)
  })
  .strict()

export type PluginSkillProvider = (typeof PLUGIN_SKILL_PROVIDERS)[number]
export type PluginSkillMappingTarget = z.infer<typeof pluginSkillMappingTargetSchema>
export type PluginSkillContributionMapping = z.infer<typeof pluginSkillContributionMappingSchema>

export type PluginSkillRegistration = {
  pluginKey: string
  contributionPath: string
  skillName: string
  providers: PluginSkillProvider[]
  materializedPaths: string[]
}

export type PluginSkillStoreSnapshot = {
  registrations: PluginSkillRegistration[]
  mappings: PluginSkillContributionMapping[]
}

import { z } from 'zod'
import { pluginCapabilitySchema } from './plugin-capabilities'
import { isSafePluginRelativePath } from './plugin-path-safety'

/**
 * Plugin manifest v1 (`orca-plugin.json` at the plugin root). The
 * `contributes` key names deliberately mirror common Electron-ecosystem
 * manifest conventions so future adapters stay cheap.
 *
 * Lives in `shared` so the desktop app, the headless `orca serve` runtime,
 * the relay, and the CLI validate manifests identically (SSH/remote parity).
 *
 * Everything here is EXPERIMENTAL: no compatibility promises until pluginApi
 * v1 freezes (see the plugin roadmap).
 */

// Why: ids become filesystem paths, IPC channel fragments, and sidebar tab
// keys — restrict to kebab-case so they never need escaping downstream.
const PLUGIN_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SEMVER_RE =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
export const PLUGIN_ID_MAX_LENGTH = 64
export const PLUGIN_PANEL_LIMIT = 64
export const PLUGIN_COMMAND_LIMIT = 256

// Why: kebab-case alone still admits names that are dangerous as object keys
// ('constructor' passes the regex). Ported from community PR #5801.
const DANGEROUS_PLUGIN_NAMES = new Set(['__proto__', 'prototype', 'constructor'])

export function isSafePluginId(id: string): boolean {
  return (
    typeof id === 'string' &&
    id.length <= PLUGIN_ID_MAX_LENGTH &&
    PLUGIN_ID_RE.test(id) &&
    !DANGEROUS_PLUGIN_NAMES.has(id)
  )
}

const pluginIdSchema = z
  .string()
  .refine(isSafePluginId, 'must be kebab-case (a-z, 0-9, dashes) and not a reserved name')

// Why: entry paths are resolved against the plugin root; reject absolute
// paths, drive prefixes, and traversal so a manifest cannot point outside its
// own directory. (Symlink escapes are caught separately by realpath
// containment when the file is read.)
const relativeEntrySchema = z
  .string()
  .min(1)
  .max(1024)
  .refine(isSafePluginRelativePath, 'must be a portable relative path inside the plugin directory')

// Why: v0 supports only the ">=x.y.z" form. A closed grammar keeps the gate
// predictable; richer ranges can be added without breaking old manifests.
const orcaEngineRangeSchema = z
  .string()
  .max(64)
  .regex(/^>=\d+\.\d+\.\d+$/, 'must be a ">=x.y.z" version range')

const panelContributionSchema = z.object({
  id: pluginIdSchema,
  title: z.string().min(1).max(256),
  /** Lucide icon name rendered in the right-sidebar activity bar. */
  icon: z.string().min(1).max(64).optional(),
  /** HTML entry rendered inside a sandboxed panel frame. */
  entry: relativeEntrySchema
})

// Why: commands use a namespaced API identity (`publisher.actionName`), not
// the filesystem-safe kebab grammar used by plugin and panel directory keys.
export const pluginCommandIdSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/, 'must be a portable command id')

const commandContributionSchema = z.object({
  id: pluginCommandIdSchema,
  title: z.string().min(1).max(256)
})

/** Domain events a plugin can subscribe to in v0. Closed set: server-side
 *  filtering means plugins only ever receive what they subscribed to. */
export const PLUGIN_EVENT_NAMES = [
  'worktree.created',
  'worktree.removed',
  'agent.status.changed'
] as const
export const PLUGIN_EVENT_SUBSCRIPTION_LIMIT = PLUGIN_EVENT_NAMES.length

export type PluginEventName = (typeof PLUGIN_EVENT_NAMES)[number]

const eventContributionSchema = z.object({
  on: z.enum(PLUGIN_EVENT_NAMES)
})

export const pluginManifestSchema = z
  .object({
    manifestVersion: z.literal(1),
    id: pluginIdSchema,
    /** Publisher slug; canonical identity is `<publisher>.<id>` — bare-id
     *  global uniqueness is unverifiable without a registry. */
    publisher: pluginIdSchema,
    name: z.string().min(1).max(256),
    version: z.string().regex(SEMVER_RE, 'must be semver'),
    description: z.string().max(4096).optional(),
    author: z
      .object({ name: z.string().min(1).max(256), url: z.string().max(2048).optional() })
      .optional(),
    repository: z.string().max(2048).optional(),
    icon: relativeEntrySchema.optional(),
    /** Minimum host version gate; the host refuses to load below it. */
    engines: z.object({ orca: orcaEngineRangeSchema }),
    /** Host-API major version this plugin targets. */
    pluginApi: z.literal(1),
    /** Node entry executed inside the out-of-process plugin worker. */
    main: relativeEntrySchema.optional(),
    contributes: z
      .object({
        panels: z.array(panelContributionSchema).max(PLUGIN_PANEL_LIMIT).default([]),
        commands: z.array(commandContributionSchema).max(PLUGIN_COMMAND_LIMIT).default([]),
        events: z.array(eventContributionSchema).max(PLUGIN_EVENT_SUBSCRIPTION_LIMIT).default([])
      })
      .default({ panels: [], commands: [], events: [] }),
    capabilities: z.array(pluginCapabilitySchema).max(32).default([])
  })
  .superRefine((manifest, ctx) => {
    const rejectDuplicateIds = (
      entries: readonly { id: string }[],
      path: 'panels' | 'commands'
    ): void => {
      const seen = new Set<string>()
      for (const [index, entry] of entries.entries()) {
        if (seen.has(entry.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['contributes', path, index, 'id'],
            message: `duplicate ${path} id: ${entry.id}`
          })
        }
        seen.add(entry.id)
      }
    }
    rejectDuplicateIds(manifest.contributes.panels, 'panels')
    rejectDuplicateIds(manifest.contributes.commands, 'commands')
    // Commands and event subscriptions are handled by the worker entry, so a
    // manifest declaring them without `main` is inert — fail at parse time
    // instead of silently never dispatching.
    if (!manifest.main && manifest.contributes.commands.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['main'],
        message: 'required when contributes.commands is non-empty'
      })
    }
    if (!manifest.main && manifest.contributes.events.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['main'],
        message: 'required when contributes.events is non-empty'
      })
    }
    // Event subscriptions must be visible at consent time: require the
    // capability so the consent dialog lists what the plugin will observe.
    if (
      manifest.contributes.events.length > 0 &&
      !manifest.capabilities.some((capability) => capability.kind === 'events:subscribe')
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['capabilities'],
        message: 'events:subscribe capability required when contributes.events is non-empty'
      })
    }
  })

export type PluginManifest = z.infer<typeof pluginManifestSchema>
export type PluginPanelContribution = z.infer<typeof panelContributionSchema>
export type PluginCommandContribution = z.infer<typeof commandContributionSchema>
export type PluginEventContribution = z.infer<typeof eventContributionSchema>

export const PLUGIN_MANIFEST_FILENAME = 'orca-plugin.json'

/** Canonical install identity: `<publisher>.<id>` (also the install dir name). */
export function qualifiedPluginKey(manifest: Pick<PluginManifest, 'publisher' | 'id'>): string {
  return `${manifest.publisher}.${manifest.id}`
}

export function isQualifiedPluginKey(value: string): boolean {
  const parts = value.split('.')
  if (parts.length !== 2) {
    return false
  }
  return isSafePluginId(parts[0]!) && isSafePluginId(parts[1]!)
}

export type PluginManifestParseResult =
  | { ok: true; manifest: PluginManifest }
  | { ok: false; error: string }

export function parsePluginManifest(raw: unknown): PluginManifestParseResult {
  const parsed = pluginManifestSchema.safeParse(raw)
  if (parsed.success) {
    return { ok: true, manifest: parsed.data }
  }
  const issue = parsed.error.issues[0]
  const path = issue?.path.join('.') || '(root)'
  return { ok: false, error: `${path}: ${issue?.message ?? 'invalid manifest'}` }
}

/** v0 engines gate: supports the ">=x.y.z" grammar the schema enforces.
 *  Prerelease/build suffixes on the host version are ignored for ordering. */
export function satisfiesOrcaEngineRange(hostVersion: string, range: string): boolean {
  const minimum = range.slice(2)
  const parse = (value: string): number[] =>
    value
      .split(/[-+]/)[0]!
      .split('.')
      .map((part) => Number.parseInt(part, 10) || 0)
  const host = parse(hostVersion)
  const min = parse(minimum)
  for (let i = 0; i < 3; i++) {
    const a = host[i] ?? 0
    const b = min[i] ?? 0
    if (a !== b) {
      return a > b
    }
  }
  return true
}

/** Sidebar tab key for a plugin panel: `plugin:<publisher>.<id>/<panelId>`. */
export function pluginPanelTabKey(qualifiedKey: string, panelId: string): `plugin:${string}` {
  return `plugin:${qualifiedKey}/${panelId}`
}

export function isPluginPanelTabKey(tab: string): tab is `plugin:${string}` {
  if (!tab.startsWith('plugin:')) {
    return false
  }
  const rest = tab.slice('plugin:'.length)
  const [qualifiedKey, panelId, ...extra] = rest.split('/')
  return (
    extra.length === 0 &&
    !!qualifiedKey &&
    !!panelId &&
    isQualifiedPluginKey(qualifiedKey) &&
    PLUGIN_ID_RE.test(panelId)
  )
}

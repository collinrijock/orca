import { translate } from '@/i18n/i18n'
import { Loader2 } from 'lucide-react'

type PluginSkillConsentPreviewProps = {
  skills: readonly { name: string; instructions: string }[]
  loading: boolean
  error: boolean
}

export function PluginSkillConsentPreview({
  skills,
  loading,
  error
}: PluginSkillConsentPreviewProps): React.JSX.Element | null {
  if (skills.length === 0 && !loading && !error) {
    return null
  }
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
        {translate(
          'auto.components.settings.PluginSkillConsentPreview.heading',
          'Agent skill instructions'
        )}
      </p>
      {loading ? (
        <p aria-live="polite" className="flex items-center gap-2 text-sm leading-6">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
          {translate(
            'auto.components.settings.PluginSkillConsentPreview.loading',
            'Loading skill instructions…'
          )}
        </p>
      ) : null}
      {skills.map((skill) => (
        <section key={skill.name} className="space-y-2 rounded-md border border-border p-3">
          <p className="font-mono text-xs font-medium">{skill.name}</p>
          <pre
            tabIndex={0}
            aria-label={translate(
              'auto.components.settings.PluginSkillConsentPreview.instructionsLabel',
              '{{value0}} skill instructions',
              { value0: skill.name }
            )}
            className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/60 p-3 font-mono text-xs leading-5 scrollbar-sleek"
          >
            {skill.instructions}
          </pre>
        </section>
      ))}
      {error ? (
        <p className="text-sm leading-6 text-destructive">
          {translate(
            'auto.components.settings.PluginSkillConsentPreview.loadError',
            'Orca could not read every skill instruction. Keep this plugin disabled and review it again after fixing the package.'
          )}
        </p>
      ) : null}
    </div>
  )
}

import type {
  OpenCodeUsageBreakdownRow,
  OpenCodeUsageDailyPoint,
  OpenCodeUsageSessionRow,
  OpenCodeUsageSummary
} from '../../../../shared/opencode-usage-types'
import { CodexUsageDailyChart } from './CodexUsageDailyChart'
import { translate } from '@/i18n/i18n'

type OpenCodeUsageDetailsProps = {
  daily: OpenCodeUsageDailyPoint[]
  formatCost: (value: number | null) => string
  formatTokens: (value: number) => string
  modelBreakdown: OpenCodeUsageBreakdownRow[]
  projectBreakdown: OpenCodeUsageBreakdownRow[]
  recentSessions: OpenCodeUsageSessionRow[]
  summary: OpenCodeUsageSummary | null | undefined
}

function formatSessionTime(timestamp: string): string {
  const parsed = new Date(timestamp)
  if (Number.isNaN(parsed.getTime())) {
    return timestamp
  }
  return parsed.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

export function OpenCodeUsageDetails({
  daily,
  formatCost,
  formatTokens,
  modelBreakdown,
  projectBreakdown,
  recentSessions,
  summary
}: OpenCodeUsageDetailsProps): React.JSX.Element {
  return (
    <>
      <CodexUsageDailyChart daily={daily} />

      <div className="grid gap-4 xl:grid-cols-2">
        <OpenCodeUsageBreakdownSection
          formatCost={formatCost}
          formatTokens={formatTokens}
          label={translate('auto.components.stats.OpenCodeUsagePane.040c044d39', 'By model')}
          rows={modelBreakdown}
          showCost={true}
          topLabel={translate('auto.components.stats.OpenCodeUsagePane.a15206a63a', 'Top model:')}
          topValue={summary?.topModel}
        />
        <OpenCodeUsageBreakdownSection
          formatCost={formatCost}
          formatTokens={formatTokens}
          label={translate('auto.components.stats.OpenCodeUsagePane.0f0a1684bb', 'By project')}
          rows={projectBreakdown}
          showCost={false}
          topLabel={translate('auto.components.stats.OpenCodeUsagePane.048ffe4d65', 'Top project:')}
          topValue={summary?.topProject}
        />
      </div>

      <section className="rounded-lg border border-border/60 bg-card/40 p-4">
        <div className="mb-3">
          <h4 className="text-sm font-semibold text-foreground">
            {translate('auto.components.stats.OpenCodeUsagePane.4799177b1c', 'Recent sessions')}
          </h4>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.stats.OpenCodeUsagePane.81817a641a',
              'Most recent local OpenCode sessions in this scope.'
            )}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                <th className="px-2 py-2 font-medium">
                  {translate('auto.components.stats.OpenCodeUsagePane.d97bdf6e27', 'Last active')}
                </th>
                <th className="px-2 py-2 font-medium">
                  {translate('auto.components.stats.OpenCodeUsagePane.a4738de041', 'Project')}
                </th>
                <th className="px-2 py-2 font-medium">
                  {translate('auto.components.stats.OpenCodeUsagePane.08c78441b7', 'Model')}
                </th>
                <th className="px-2 py-2 font-medium">
                  {translate('auto.components.stats.OpenCodeUsagePane.d416f5cf92', 'Events')}
                </th>
                <th className="px-2 py-2 font-medium">
                  {translate('auto.components.stats.OpenCodeUsagePane.0f2f266c9d', 'Input')}
                </th>
                <th className="px-2 py-2 font-medium">
                  {translate('auto.components.stats.OpenCodeUsagePane.dfc4513657', 'Output')}
                </th>
                <th className="px-2 py-2 font-medium">
                  {translate('auto.components.stats.OpenCodeUsagePane.349f7c3f5c', 'Total')}
                </th>
              </tr>
            </thead>
            <tbody>
              {recentSessions.map((row) => (
                <tr key={row.sessionId} className="border-b border-border/40 last:border-b-0">
                  <td className="px-2 py-2 text-muted-foreground">
                    {formatSessionTime(row.lastActiveAt)}
                  </td>
                  <td className="px-2 py-2 text-foreground">{row.projectLabel}</td>
                  <td className="px-2 py-2 text-muted-foreground">
                    {row.model ??
                      translate('auto.components.stats.OpenCodeUsagePane.362231082f', 'Unknown')}
                  </td>
                  <td className="px-2 py-2 text-muted-foreground">{row.events}</td>
                  <td className="px-2 py-2 text-muted-foreground">
                    {formatTokens(row.inputTokens)}
                  </td>
                  <td className="px-2 py-2 text-muted-foreground">
                    {formatTokens(row.outputTokens)}
                  </td>
                  <td className="px-2 py-2 text-muted-foreground">
                    {formatTokens(row.totalTokens)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}

function OpenCodeUsageBreakdownSection({
  formatCost,
  formatTokens,
  label,
  rows,
  showCost,
  topLabel,
  topValue
}: {
  formatCost: (value: number | null) => string
  formatTokens: (value: number) => string
  label: string
  rows: OpenCodeUsageBreakdownRow[]
  showCost: boolean
  topLabel: string
  topValue: string | null | undefined
}): React.JSX.Element {
  return (
    <section className="rounded-lg border border-border/60 bg-card/40 p-4">
      <div className="mb-3">
        <h4 className="text-sm font-semibold text-foreground">{label}</h4>
        <p className="text-xs text-muted-foreground">
          {topLabel}{' '}
          {topValue ?? translate('auto.components.stats.OpenCodeUsagePane.8095a63426', 'n/a')}
        </p>
      </div>
      <div className="space-y-3">
        {rows.slice(0, 5).map((row) => (
          <div key={row.key} className="space-y-1">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="truncate text-foreground">{row.label}</span>
              <span className="shrink-0 text-muted-foreground">
                {formatTokens(row.totalTokens)}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              {row.sessions}{' '}
              {translate('auto.components.stats.OpenCodeUsagePane.bc0cb89901', 'sessions •')}{' '}
              {row.events}{' '}
              {translate('auto.components.stats.OpenCodeUsagePane.1e5d410df0', 'events')}
              {showCost && row.estimatedCostUsd !== null
                ? ` • ${formatCost(row.estimatedCostUsd)}`
                : ''}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

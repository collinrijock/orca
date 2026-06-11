import type {
  ClaudeUsageBreakdownRow,
  ClaudeUsageDailyPoint,
  ClaudeUsageSessionRow,
  ClaudeUsageSummary
} from '../../../../shared/claude-usage-types'
import { ClaudeUsageDailyChart } from './ClaudeUsageDailyChart'
import { translate } from '@/i18n/i18n'

type ClaudeUsageDetailsProps = {
  daily: ClaudeUsageDailyPoint[]
  formatTokens: (value: number) => string
  modelBreakdown: ClaudeUsageBreakdownRow[]
  projectBreakdown: ClaudeUsageBreakdownRow[]
  recentSessions: ClaudeUsageSessionRow[]
  summary: ClaudeUsageSummary | null | undefined
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

export function ClaudeUsageDetails({
  daily,
  formatTokens,
  modelBreakdown,
  projectBreakdown,
  recentSessions,
  summary
}: ClaudeUsageDetailsProps): React.JSX.Element {
  return (
    <>
      <ClaudeUsageDailyChart daily={daily} />

      <div className="grid gap-4 xl:grid-cols-2">
        <ClaudeUsageBreakdownSection
          formatTokens={formatTokens}
          label={translate('auto.components.stats.ClaudeUsagePane.0f394c24e3', 'By model')}
          rows={modelBreakdown}
          topLabel={translate('auto.components.stats.ClaudeUsagePane.c3fdbc5474', 'Top model:')}
          topValue={summary?.topModel}
        />
        <ClaudeUsageBreakdownSection
          formatTokens={formatTokens}
          label={translate('auto.components.stats.ClaudeUsagePane.7dc9e5613b', 'By project')}
          rows={projectBreakdown}
          topLabel={translate('auto.components.stats.ClaudeUsagePane.f97435845c', 'Top project:')}
          topValue={summary?.topProject}
        />
      </div>

      <section className="rounded-lg border border-border/60 bg-card/40 p-4">
        <div className="mb-3">
          <h4 className="text-sm font-semibold text-foreground">
            {translate('auto.components.stats.ClaudeUsagePane.7e76c84153', 'Recent sessions')}
          </h4>
          <p className="text-xs text-muted-foreground">
            {translate('auto.components.stats.ClaudeUsagePane.abfc4a4943', 'Cache reuse rate:')}{' '}
            {summary?.cacheReuseRate !== null && summary?.cacheReuseRate !== undefined
              ? `${Math.round(summary.cacheReuseRate * 100)}%`
              : translate('auto.components.stats.ClaudeUsagePane.7765a4c3e1', 'n/a')}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                <th className="px-2 py-2 font-medium">
                  {translate('auto.components.stats.ClaudeUsagePane.01476891c7', 'Last active')}
                </th>
                <th className="px-2 py-2 font-medium">
                  {translate('auto.components.stats.ClaudeUsagePane.c17bed0416', 'Project')}
                </th>
                <th className="px-2 py-2 font-medium">
                  {translate('auto.components.stats.ClaudeUsagePane.1afc25eb06', 'Model')}
                </th>
                <th className="px-2 py-2 font-medium">
                  {translate('auto.components.stats.ClaudeUsagePane.0f03975d59', 'Turns')}
                </th>
                <th className="px-2 py-2 font-medium">
                  {translate('auto.components.stats.ClaudeUsagePane.faf3444859', 'Input')}
                </th>
                <th className="px-2 py-2 font-medium">
                  {translate('auto.components.stats.ClaudeUsagePane.a8b7487ff7', 'Output')}
                </th>
                <th className="px-2 py-2 font-medium">
                  {translate('auto.components.stats.ClaudeUsagePane.21ea00bfa8', 'Cache')}
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
                      translate('auto.components.stats.ClaudeUsagePane.cfe2282ffa', 'Unknown')}
                  </td>
                  <td className="px-2 py-2 text-muted-foreground">{row.turns}</td>
                  <td className="px-2 py-2 text-muted-foreground">
                    {formatTokens(row.inputTokens)}
                  </td>
                  <td className="px-2 py-2 text-muted-foreground">
                    {formatTokens(row.outputTokens)}
                  </td>
                  <td className="px-2 py-2 text-muted-foreground">
                    {formatTokens(row.cacheReadTokens + row.cacheWriteTokens)}
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

function ClaudeUsageBreakdownSection({
  formatTokens,
  label,
  rows,
  topLabel,
  topValue
}: {
  formatTokens: (value: number) => string
  label: string
  rows: ClaudeUsageBreakdownRow[]
  topLabel: string
  topValue: string | null | undefined
}): React.JSX.Element {
  return (
    <section className="rounded-lg border border-border/60 bg-card/40 p-4">
      <div className="mb-3">
        <h4 className="text-sm font-semibold text-foreground">{label}</h4>
        <p className="text-xs text-muted-foreground">
          {topLabel}{' '}
          {topValue ?? translate('auto.components.stats.ClaudeUsagePane.7765a4c3e1', 'n/a')}
        </p>
      </div>
      <div className="space-y-3">
        {rows.slice(0, 5).map((row) => (
          <div key={row.key} className="space-y-1">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="truncate text-foreground">{row.label}</span>
              <span className="shrink-0 text-muted-foreground">
                {formatTokens(row.inputTokens + row.outputTokens)}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              {row.sessions}{' '}
              {translate('auto.components.stats.ClaudeUsagePane.02a046792e', 'sessions •')}{' '}
              {row.turns} {translate('auto.components.stats.ClaudeUsagePane.32176e1d44', 'turns')}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

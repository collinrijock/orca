import type {
  CodexUsageBreakdownRow,
  CodexUsageDailyPoint,
  CodexUsageSessionRow,
  CodexUsageSummary
} from '../../../../shared/codex-usage-types'
import { CodexUsageDailyChart } from './CodexUsageDailyChart'
import { translate } from '@/i18n/i18n'

type CodexUsageDetailsProps = {
  daily: CodexUsageDailyPoint[]
  formatTokens: (value: number) => string
  modelBreakdown: CodexUsageBreakdownRow[]
  projectBreakdown: CodexUsageBreakdownRow[]
  recentSessions: CodexUsageSessionRow[]
  summary: CodexUsageSummary | null | undefined
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

export function CodexUsageDetails({
  daily,
  formatTokens,
  modelBreakdown,
  projectBreakdown,
  recentSessions,
  summary
}: CodexUsageDetailsProps): React.JSX.Element {
  return (
    <>
      <CodexUsageDailyChart daily={daily} />

      <div className="grid gap-4 xl:grid-cols-2">
        <CodexUsageBreakdownSection
          formatTokens={formatTokens}
          label={translate('auto.components.stats.CodexUsagePane.5a0d1d69cd', 'By model')}
          rows={modelBreakdown}
          showInferredPricing={true}
          topLabel={translate('auto.components.stats.CodexUsagePane.95d2d89285', 'Top model:')}
          topValue={summary?.topModel}
        />
        <CodexUsageBreakdownSection
          formatTokens={formatTokens}
          label={translate('auto.components.stats.CodexUsagePane.b98718aaab', 'By project')}
          rows={projectBreakdown}
          showInferredPricing={false}
          topLabel={translate('auto.components.stats.CodexUsagePane.829ee743f2', 'Top project:')}
          topValue={summary?.topProject}
        />
      </div>

      <section className="rounded-lg border border-border/60 bg-card/40 p-4">
        <div className="mb-3">
          <h4 className="text-sm font-semibold text-foreground">
            {translate('auto.components.stats.CodexUsagePane.0cb0983c07', 'Recent sessions')}
          </h4>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.stats.CodexUsagePane.0bd8655475',
              'Most recent local Codex sessions in this scope.'
            )}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                <th className="px-2 py-2 font-medium">
                  {translate('auto.components.stats.CodexUsagePane.0c36b100be', 'Last active')}
                </th>
                <th className="px-2 py-2 font-medium">
                  {translate('auto.components.stats.CodexUsagePane.1a65900aea', 'Project')}
                </th>
                <th className="px-2 py-2 font-medium">
                  {translate('auto.components.stats.CodexUsagePane.c2478bcc3c', 'Model')}
                </th>
                <th className="px-2 py-2 font-medium">
                  {translate('auto.components.stats.CodexUsagePane.bd0822ca47', 'Events')}
                </th>
                <th className="px-2 py-2 font-medium">
                  {translate('auto.components.stats.CodexUsagePane.3acc582214', 'Input')}
                </th>
                <th className="px-2 py-2 font-medium">
                  {translate('auto.components.stats.CodexUsagePane.bbd20344b8', 'Output')}
                </th>
                <th className="px-2 py-2 font-medium">
                  {translate('auto.components.stats.CodexUsagePane.e0b988599d', 'Total')}
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
                      translate('auto.components.stats.CodexUsagePane.bf6cf2d4dd', 'Unknown')}
                    {row.hasInferredPricing ? ' *' : ''}
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

function CodexUsageBreakdownSection({
  formatTokens,
  label,
  rows,
  showInferredPricing,
  topLabel,
  topValue
}: {
  formatTokens: (value: number) => string
  label: string
  rows: CodexUsageBreakdownRow[]
  showInferredPricing: boolean
  topLabel: string
  topValue: string | null | undefined
}): React.JSX.Element {
  return (
    <section className="rounded-lg border border-border/60 bg-card/40 p-4">
      <div className="mb-3">
        <h4 className="text-sm font-semibold text-foreground">{label}</h4>
        <p className="text-xs text-muted-foreground">
          {topLabel}{' '}
          {topValue ?? translate('auto.components.stats.CodexUsagePane.ae255c3dba', 'n/a')}
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
              {translate('auto.components.stats.CodexUsagePane.bf1bf2f674', 'sessions •')}{' '}
              {row.events} {translate('auto.components.stats.CodexUsagePane.79a69522a5', 'events')}
              {showInferredPricing && row.hasInferredPricing
                ? ` ${translate(
                    'auto.components.stats.CodexUsagePane.247c93ca92',
                    '• inferred pricing'
                  )}`
                : ''}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

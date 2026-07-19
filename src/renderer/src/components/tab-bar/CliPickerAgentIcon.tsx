import { AgentIcon } from '@/lib/agent-catalog'
import type { TuiAgent } from '../../../../shared/types'

export function CliPickerAgentIcon({ agent }: { agent: TuiAgent }): React.JSX.Element {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-sm bg-foreground/80 ring-1 ring-inset ring-border dark:bg-foreground/10">
      <AgentIcon agent={agent} size={14} />
    </span>
  )
}

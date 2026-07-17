import { translate } from '@/i18n/i18n'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'
import type { SkillUsageExample } from './skill-usage-example'

export const getLinearUsageExamples = createLocalizedCatalog((): SkillUsageExample[] => [
  {
    id: 'read-ticket',
    title: translate('auto.lib.linear.usage.examples.readTicket', 'Read the linked ticket'),
    summary: "Pull the linked Linear issue's full context before starting work.",
    prompt:
      'Use /orca-linear to read the linked Linear issue for this worktree, then summarize the goal and acceptance criteria before you start.'
  },
  {
    id: 'post-update',
    title: translate('auto.lib.linear.usage.examples.postUpdate', 'Post a progress update'),
    summary: 'Comment progress or a completion summary back to the Linear issue.',
    prompt:
      'Use /orca-linear to post a completion update on the linked Linear issue with what changed and how it was verified.'
  },
  {
    id: 'move-state',
    title: translate('auto.lib.linear.usage.examples.moveState', 'Move the ticket forward'),
    summary: 'Advance the Linear workflow state as the work progresses.',
    prompt:
      'Use /orca-linear to move the linked Linear issue to In Review now that the change is ready.'
  },
  {
    id: 'attach-pr',
    title: translate('auto.lib.linear.usage.examples.attachPr', 'Attach the PR link'),
    summary: 'Link the pull request to the Linear issue when you open it.',
    prompt: 'Use /orca-linear to attach this PR to the linked Linear issue with a PR link.'
  },
  {
    id: 'triage-followups',
    title: translate(
      'auto.lib.linear.usage.examples.triageFollowups',
      'Triage and create follow-ups'
    ),
    summary: 'Set assignee, priority, or estimate, and file parented follow-up tickets.',
    prompt:
      'Use /orca-linear to triage the linked Linear issue — set priority and estimate — and create a parented follow-up ticket for the deferred cleanup.'
  }
])

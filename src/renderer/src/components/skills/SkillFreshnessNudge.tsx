import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useSkillFreshness } from '@/hooks/useSkillFreshness'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { requestSkillFreshnessUpdateDialog } from './skill-freshness-update-dialog'

const MAX_DISMISSED_FRESHNESS_NUDGES = 512
const NO_DISMISSED_FRESHNESS_NUDGES: string[] = []

function candidateKey(args: {
  physicalIdentity: string
  name: string
  currentReleaseRevision: number
}): string {
  return [args.physicalIdentity, args.name, args.currentReleaseRevision].join('\0')
}

export function SkillFreshnessNudge(): null {
  const state = useSkillFreshness()
  const settings = useAppStore((store) => store.settings)
  const dismissed = settings?.dismissedSkillFreshnessNudges ?? NO_DISMISSED_FRESHNESS_NUDGES
  const updateSettings = useAppStore((store) => store.updateSettings)
  const shownFingerprints = useRef(new Set<string>())
  const persistedFingerprints = useRef(new Set<string>())

  useEffect(() => {
    const inventory = state.inventory
    if (!settings || !inventory || inventory.eligibleUpdateNames.length === 0) {
      return
    }
    const eligibleNames = new Set(inventory.eligibleUpdateNames)
    const candidates = inventory.installations.flatMap((installation) =>
      installation.status === 'outdated' &&
      eligibleNames.has(installation.name) &&
      installation.physicalIdentity
        ? [
            {
              key: candidateKey({
                physicalIdentity: installation.physicalIdentity,
                name: installation.name,
                currentReleaseRevision: installation.currentReleaseRevision
              }),
              name: installation.name
            }
          ]
        : []
    )
    const dismissedKeys = new Set(dismissed)
    const unseen = candidates.filter((candidate) => !dismissedKeys.has(candidate.key))
    if (unseen.length === 0) {
      return
    }
    const fingerprint = unseen
      .map((candidate) => candidate.key)
      .sort((left, right) => left.localeCompare(right, 'en'))
      .join('\n')
    if (shownFingerprints.current.has(fingerprint)) {
      return
    }
    shownFingerprints.current.add(fingerprint)

    const persistDismissal = (): void => {
      if (persistedFingerprints.current.has(fingerprint)) {
        return
      }
      persistedFingerprints.current.add(fingerprint)
      const current = useAppStore.getState().settings?.dismissedSkillFreshnessNudges ?? []
      const next = [...new Set([...current, ...unseen.map((candidate) => candidate.key)])].slice(
        -MAX_DISMISSED_FRESHNESS_NUDGES
      )
      void updateSettings({ dismissedSkillFreshnessNudges: next }).catch(() => {
        persistedFingerprints.current.delete(fingerprint)
      })
    }
    const names = new Set(unseen.map((candidate) => candidate.name))
    toast.info(
      names.size === 1
        ? translate(
            'auto.components.skills.SkillFreshnessNudge.titleOne',
            'An installed Orca skill is out of date'
          )
        : translate(
            'auto.components.skills.SkillFreshnessNudge.titleMany',
            '{{value0}} installed Orca skills are out of date',
            { value0: names.size }
          ),
      {
        description: translate(
          'auto.components.skills.SkillFreshnessNudge.description',
          'Orca recognized exact older official copies. Review the targeted update command before running it.'
        ),
        // Why: the nudge lingers until the user acts. Ignoring it (app quit)
        // records nothing, so a still-outdated skill may prompt once next launch.
        duration: Number.POSITIVE_INFINITY,
        // Why: only an explicit dismissal (the close button) records the keys;
        // opening the review dialog is engagement, not a decision to hide it.
        onDismiss: persistDismissal,
        action: {
          label: translate(
            'auto.components.skills.SkillFreshnessNudge.review',
            'Review update command'
          ),
          onClick: () => requestSkillFreshnessUpdateDialog()
        }
      }
    )
  }, [dismissed, settings, state.inventory, updateSettings])

  return null
}

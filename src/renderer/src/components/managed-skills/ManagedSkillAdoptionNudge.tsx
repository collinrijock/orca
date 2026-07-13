import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useManagedAgentSkills } from '@/hooks/useManagedAgentSkills'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'

export function ManagedSkillAdoptionNudge(): null {
  const state = useManagedAgentSkills()
  const shownKeys = useRef(new Set<string>())
  const persistedKeys = useRef(new Set<string>())
  const openSettingsPage = useAppStore((store) => store.openSettingsPage)
  const openSettingsTarget = useAppStore((store) => store.openSettingsTarget)

  useEffect(() => {
    const candidates =
      state.inventory?.installations.filter(
        (installation) => installation.adoptionPromptEligible
      ) ?? []
    const candidateKey = (candidate: (typeof candidates)[number]): string =>
      [
        candidate.hostId,
        candidate.physicalIdentity,
        candidate.name,
        candidate.installedPackageDigest
      ].join('\0')
    const unseen = candidates.filter((candidate) => !shownKeys.current.has(candidateKey(candidate)))
    if (unseen.length === 0) {
      return
    }
    for (const candidate of unseen) {
      shownKeys.current.add(candidateKey(candidate))
    }
    const persistDismissal = (): void => {
      const pending = unseen.flatMap((candidate) => {
        const key = candidateKey(candidate)
        if (persistedKeys.current.has(key)) {
          return []
        }
        persistedKeys.current.add(key)
        return [{ candidate, key }]
      })
      // Why: Sonner may report action, dismiss, and auto-close for one toast;
      // each exact tuple must reach the durable ledger only once.
      for (const { candidate, key } of pending) {
        void state.dismiss(candidate).catch(() => persistedKeys.current.delete(key))
      }
    }
    const count = unseen.length
    toast.info(
      count === 1
        ? translate(
            'auto.components.managedSkills.adoptionNudge.title_one',
            'Track updates for an installed Orca skill?',
            { value0: count }
          )
        : translate(
            'auto.components.managedSkills.adoptionNudge.title_other',
            'Track updates for {{value0}} installed Orca skills?',
            { value0: count }
          ),
      {
        description: translate(
          'auto.components.managedSkills.adoptionNudge.description',
          'These match Orca’s official versions. Orca shows when updates are available and only installs one after you approve it.'
        ),
        duration: 12_000,
        onDismiss: persistDismissal,
        onAutoClose: persistDismissal,
        action: {
          label: translate('auto.components.managedSkills.adoptionNudge.review', 'Choose skills'),
          onClick: () => {
            openSettingsTarget({ pane: 'agents', repoId: null })
            openSettingsPage()
            persistDismissal()
          }
        }
      }
    )
  }, [openSettingsPage, openSettingsTarget, state])

  return null
}

import { useMemo, useState } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { ChevronLeft } from 'lucide-react-native'
import { colors, spacing } from '../theme/mobile-theme'
import { BottomDrawer } from '../components/BottomDrawer'
import type { RpcClient } from '../transport/rpc-client'
import type { TerminalQuickCommand } from '../../../src/shared/types'
import { getQuickCommandPreview, quickCommandMatchesRepo } from '../terminal/quick-commands'
import { useQuickCommands } from './use-quick-commands'
import { QuickCommandEditorForm } from './QuickCommandEditorForm'
import { QuickCommandAgentPicker, QuickCommandsList } from './QuickCommandsList'
import {
  createEmptyQuickCommandDraft,
  draftToQuickCommand,
  quickCommandToDraft,
  type QuickCommandDraft
} from './quick-command-draft'

type Props = {
  visible: boolean
  onClose: () => void
  client: RpcClient | null
  repoId: string | null
  repoName: string | null
  onLaunch: (command: TerminalQuickCommand) => void
}

type SheetView = 'list' | 'editor' | 'agent'

export function QuickCommandsSheet({
  visible,
  onClose,
  client,
  repoId,
  repoName,
  onLaunch
}: Props) {
  const { commands, loading, error, persist } = useQuickCommands({ client, enabled: visible })
  const [view, setView] = useState<SheetView>('list')
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<QuickCommandDraft | null>(null)
  const [saving, setSaving] = useState(false)

  const [wasVisible, setWasVisible] = useState(visible)
  if (visible !== wasVisible) {
    setWasVisible(visible)
    if (visible) {
      setView('list')
      setQuery('')
      setDraft(null)
    }
  }

  const visibleCommands = useMemo(() => {
    const trimmed = query.trim().toLowerCase()
    return commands.filter((command) => {
      if (!quickCommandMatchesRepo(command, repoId)) {
        return false
      }
      if (!trimmed) {
        return true
      }
      return `${command.label} ${getQuickCommandPreview(command)}`.toLowerCase().includes(trimmed)
    })
  }, [commands, query, repoId])

  const repoCommands = visibleCommands.filter((command) => command.scope?.type === 'repo')
  const globalCommands = visibleCommands.filter((command) => command.scope?.type !== 'repo')

  const openEditor = (command?: TerminalQuickCommand) => {
    setDraft(
      command
        ? quickCommandToDraft(command)
        : createEmptyQuickCommandDraft(repoId ? { type: 'repo', repoId } : { type: 'global' })
    )
    setView('editor')
  }

  const handleLaunch = (command: TerminalQuickCommand) => {
    onLaunch(command)
    onClose()
  }

  const handleDelete = (command: TerminalQuickCommand) => {
    void persist(commands.filter((entry) => entry.id !== command.id))
  }

  const handleSave = async () => {
    if (!draft) {
      return
    }
    const built = draftToQuickCommand(draft)
    if (!built) {
      return
    }
    const exists = commands.some((entry) => entry.id === built.id)
    const next = exists
      ? commands.map((entry) => (entry.id === built.id ? built : entry))
      : [...commands, built]
    setSaving(true)
    const ok = await persist(next)
    setSaving(false)
    if (ok) {
      setView('list')
      setDraft(null)
    }
  }

  const title =
    view === 'editor'
      ? draft?.id
        ? 'Edit Quick Command'
        : 'Add Quick Command'
      : view === 'agent'
        ? 'Choose Agent'
        : 'Quick Commands'

  return (
    <BottomDrawer visible={visible} onClose={onClose}>
      <View style={styles.header}>
        {view === 'list' ? (
          <View style={styles.backSpacer} />
        ) : (
          <Pressable
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
            onPress={() => setView(view === 'agent' ? 'editor' : 'list')}
            accessibilityLabel="Back"
          >
            <ChevronLeft size={18} color={colors.textSecondary} />
          </Pressable>
        )}
        <Text style={styles.title}>{title}</Text>
        <View style={styles.backSpacer} />
      </View>

      {view === 'editor' && draft ? (
        <View style={styles.editorDesc}>
          <Text style={styles.descText}>
            Save terminal commands or agent prompts for quick access.
          </Text>
        </View>
      ) : null}

      {view === 'list' ? (
        <QuickCommandsList
          repoCommands={repoCommands}
          globalCommands={globalCommands}
          totalCount={commands.length}
          query={query}
          loading={loading}
          error={error}
          onQueryChange={setQuery}
          onLaunch={handleLaunch}
          onEdit={openEditor}
          onDelete={handleDelete}
          onAdd={() => openEditor()}
        />
      ) : null}

      {view === 'editor' && draft ? (
        <QuickCommandEditorForm
          draft={draft}
          mode={draft.id ? 'edit' : 'add'}
          saving={saving}
          error={error}
          repoId={repoId}
          repoName={repoName}
          onChange={(patch) =>
            setDraft((current) => (current ? { ...current, ...patch } : current))
          }
          onOpenAgentPicker={() => setView('agent')}
          onCancel={() => {
            setView('list')
            setDraft(null)
          }}
          onSave={() => void handleSave()}
        />
      ) : null}

      {view === 'agent' && draft ? (
        <QuickCommandAgentPicker
          selected={draft.agent}
          onSelect={(agent) => {
            setDraft((current) => (current ? { ...current, agent } : current))
            setView('editor')
          }}
        />
      ) : null}
    </BottomDrawer>
  )
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingBottom: spacing.sm },
  backButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center'
  },
  backSpacer: { width: 30 },
  title: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center'
  },
  pressed: { backgroundColor: colors.bgRaised },
  editorDesc: { paddingHorizontal: spacing.xs, paddingBottom: spacing.sm },
  descText: { fontSize: 12, color: colors.textMuted }
})

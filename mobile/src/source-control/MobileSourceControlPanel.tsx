import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { colors } from '../theme/mobile-theme'
import { useMobileSourceControlState } from './use-mobile-source-control-state'
import { useMobileSourceControlActionSheet } from './use-mobile-source-control-action-sheet'
import { MobileSourceControlHeader } from './MobileSourceControlHeader'
import { MobileSourceControlContent } from './MobileSourceControlContent'
import { MobileSourceControlModals } from './MobileSourceControlModals'
import { MobileSourceControlSegments } from './MobileSourceControlSegments'
import { MobileSourceControlBranchCard } from './MobileSourceControlBranchCard'
import { MobileGitHistoryList } from './MobileGitHistoryList'
import { styles } from './mobile-source-control-styles'
import { hubStyles } from './mobile-source-control-hub-styles'
import type { SourceControlHubTab } from './mobile-source-control-hub-tab'
import { buildMobilePrChipSummary, countUnresolvedReviewThreads } from './mobile-pr-chip-summary'
import { useMobilePrSidebarController } from '../session/use-mobile-pr-sidebar-controller'
import { MobilePrViewPanelBody } from '../components/pr-sidebar/MobilePrViewPanel'

export type MobileSourceControlPanelProps = {
  hostId: string
  worktreeId: string
  name?: string
  /** Where the panel was launched from; drives the file-open dismissal path. */
  origin?: string
  embedded?: boolean
  /** Initial hub segment (from the route's `tab` deep-link param). */
  initialTab?: SourceControlHubTab
  onRequestClose?: () => void
  onFileOpenStart?: () => void
  onOpenedFileDiff?: (relativePath: string) => void
}

export function MobileSourceControlPanel({
  hostId,
  worktreeId,
  name = '',
  origin = '',
  embedded = false,
  initialTab = 'changes',
  onRequestClose,
  onFileOpenStart,
  onOpenedFileDiff
}: MobileSourceControlPanelProps) {
  const [activeTab, setActiveTab] = useState<SourceControlHubTab>(initialTab)
  // Track first visit so PR/History keep their fetch + scroll state across segment
  // switches without paying the mount cost until the user actually opens them.
  const [visitedTabs, setVisitedTabs] = useState<ReadonlySet<SourceControlHubTab>>(
    () => new Set<SourceControlHubTab>([initialTab])
  )
  const [historyRefreshNonce, setHistoryRefreshNonce] = useState(0)

  // Deep-link / push with a different `tab` param should adopt the new segment
  // (expo-router can reuse the screen instance when only query params change).
  useEffect(() => {
    setActiveTab(initialTab)
    setVisitedTabs((prev) => {
      if (prev.has(initialTab)) {
        return prev
      }
      const next = new Set(prev)
      next.add(initialTab)
      return next
    })
  }, [initialTab])

  const selectTab = useCallback((tab: SourceControlHubTab) => {
    setActiveTab(tab)
    setVisitedTabs((prev) => {
      if (prev.has(tab)) {
        return prev
      }
      const next = new Set(prev)
      next.add(tab)
      return next
    })
  }, [])
  const openHistoryTab = useCallback(() => selectTab('history'), [selectTab])
  const openPrTab = useCallback(() => selectTab('pr'), [selectTab])

  const state = useMobileSourceControlState({
    hostId,
    worktreeId,
    name,
    origin,
    embedded,
    onRequestClose,
    onFileOpenStart,
    onOpenedFileDiff,
    onOpenHistory: openHistoryTab
  })
  const actionSheetActions = useMobileSourceControlActionSheet(state)
  const {
    client,
    connState,
    forceReconnect,
    insets,
    router,
    setRootRef,
    worktreeLabel,
    screenState,
    busyAction,
    openingPath,
    openingBranchPath,
    loadStatus,
    status,
    branchLabel,
    syncLabel,
    unstagedCount,
    stagedCount,
    branchEntries,
    abortConflictOperation
  } = state
  const ioBusy = busyAction !== null || openingPath !== null || openingBranchPath !== null
  const ready = screenState.kind === 'ready'

  // One PR controller feeds both the branch-card chip and the Pull Request
  // segment, so the chip's rollup can never disagree with the checks list it
  // links to. Branch + head come from the already-loaded git.status — no second
  // status read. The chip loads independently, so it never blocks the file list.
  const prBranch = status?.branch ?? null
  const prHeadSha = status?.head ?? null
  const prController = useMobilePrSidebarController({
    client,
    connState,
    worktreeId,
    branch: prBranch,
    headSha: prHeadSha
  })
  const isHostedRepo = prController.prSidebarIsGithubRepo
  const prSidebarKind = prController.prSidebarState.kind
  const refetchPr = prController.refetchPRSidebar
  useEffect(() => {
    if (prBranch && isHostedRepo && prSidebarKind === 'hidden') {
      refetchPr()
    }
  }, [prBranch, isHostedRepo, prSidebarKind, refetchPr])

  const prChip = useMemo(() => {
    if (!isHostedRepo) {
      return null
    }
    const commentCount =
      prController.prSidebarState.kind === 'ready'
        ? countUnresolvedReviewThreads(prController.prSidebarState.data.details?.comments)
        : null
    return buildMobilePrChipSummary(prController.prSidebarState, commentCount)
  }, [isHostedRepo, prController.prSidebarState])

  const onRefresh = useCallback(() => {
    void loadStatus()
    // Chip + PR segment share the controller; always refresh when hosted so the
    // branch card stays in sync even while the Changes segment is active.
    if (isHostedRepo) {
      void refetchPr()
    }
    if (visitedTabs.has('history')) {
      setHistoryRefreshNonce((n) => n + 1)
    }
  }, [isHostedRepo, loadStatus, refetchPr, visitedTabs])

  // Embedded mode docks beside the terminal: close the dock instead of popping
  // a route, and skip the full-screen safe-area chrome (the dock column owns it).
  const onBack = embedded ? (onRequestClose ?? (() => router.back())) : () => router.back()
  const header = (
    <MobileSourceControlHeader
      embedded={embedded}
      worktreeLabel={worktreeLabel}
      ioBusy={ioBusy}
      onBack={onBack}
      onRefresh={onRefresh}
    />
  )

  const statusGate =
    screenState.kind === 'loading' ? (
      <View style={styles.state}>
        <ActivityIndicator size="small" color={colors.textSecondary} />
      </View>
    ) : screenState.kind === 'error' || screenState.kind === 'unavailable' ? (
      <View style={styles.state}>
        <Text style={styles.stateTitle}>
          {screenState.kind === 'unavailable' ? 'Source Control Unavailable' : 'Unable to Load'}
        </Text>
        <Text style={styles.stateText}>{screenState.message}</Text>
        {screenState.kind === 'error' ? (
          <Pressable
            style={styles.retryButton}
            onPress={() => {
              // Why: retrying the request is useless while the transport's
              // reconnect loop is parked at its give-up cap — revive the
              // connection instead (issue #5049). loadStatus re-runs via
              // its connState effect once the new client connects.
              if (connState !== 'connected' && hostId) {
                void forceReconnect(hostId)
                return
              }
              void loadStatus()
            }}
          >
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        ) : null}
      </View>
    ) : null

  // History only needs the RPC client — do not block it behind git.status.
  // Changes/PR need status (branch, file list, head SHA), so they stay gated.
  const showHistory = activeTab === 'history' || visitedTabs.has('history')
  const showPr = ready && (activeTab === 'pr' || visitedTabs.has('pr'))

  return (
    <View ref={setRootRef} style={styles.container}>
      {embedded ? (
        <View style={styles.header}>{header}</View>
      ) : (
        <SafeAreaView style={styles.header} edges={['top']}>
          {header}
        </SafeAreaView>
      )}

      <MobileSourceControlSegments active={activeTab} onSelect={selectTab} />

      {ready ? (
        <MobileSourceControlBranchCard
          branchLabel={branchLabel}
          syncLabel={syncLabel}
          unstagedCount={unstagedCount}
          stagedCount={stagedCount}
          branchCount={branchEntries.length}
          conflictOperation={status?.conflictOperation ?? null}
          conflictBusy={busyAction !== null}
          onAbortConflict={(operation) => void abortConflictOperation(operation)}
          prChip={prChip}
          onOpenPr={openPrTab}
        />
      ) : null}

      {activeTab === 'changes' ? (
        ready ? (
          <MobileSourceControlContent state={state} />
        ) : (
          statusGate
        )
      ) : null}

      {showPr ? (
        <View style={activeTab === 'pr' ? hubStyles.tabBody : hubStyles.tabBodyHidden}>
          <MobilePrViewPanelBody
            client={client}
            connState={connState}
            worktreeId={worktreeId}
            branch={prBranch}
            headSha={prHeadSha}
            gitStatus={status}
            isGithubRepo={isHostedRepo}
            branchContextLoaded={ready}
            controller={prController}
            chromeless
            autoLoad={false}
          />
        </View>
      ) : activeTab === 'pr' ? (
        statusGate
      ) : null}

      {showHistory ? (
        <View style={activeTab === 'history' ? hubStyles.tabBody : hubStyles.tabBodyHidden}>
          <MobileGitHistoryList
            client={client}
            connState={connState}
            worktreeId={worktreeId}
            hostId={hostId}
            bottomInset={insets.bottom}
            refreshNonce={historyRefreshNonce}
          />
        </View>
      ) : null}

      <MobileSourceControlModals state={state} actionSheetActions={actionSheetActions} />
    </View>
  )
}

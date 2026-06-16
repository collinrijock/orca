import type { Page } from '@stablyai/playwright-test'

export type TerminalLivenessClassification =
  | 'no-active-pane'
  | 'no-pty-binding'
  | 'pty-backend-not-echoing'
  | 'xterm-buffer-not-updating'
  | 'terminal-layer-healthy'

export type TerminalLivenessProbe = {
  marker: string
  elapsedMs: number | null
  worktreeId: string | null
  tabId: string | null
  pane: {
    exists: boolean
    paneId: number | null
    leafId: string | null
    ptyId: string | null
    serializedTail: string
    serializedContainsMarker: boolean
    textareaFocused: boolean
    canvasCount: number
    xtermElementConnected: boolean
  }
  store: {
    ptyIdsForTab: string[]
    activeTabType: string | null
  }
  mainBuffer: {
    available: boolean
    containsMarker: boolean
    tail: string
  }
  renderingDiagnostics: unknown[]
  schedulerDebug: unknown | null
}

export function classifyTerminalLivenessProbe(
  probe: TerminalLivenessProbe
): TerminalLivenessClassification {
  if (!probe.pane.exists) {
    return 'no-active-pane'
  }
  if (!probe.pane.ptyId || !probe.store.ptyIdsForTab.includes(probe.pane.ptyId)) {
    return 'no-pty-binding'
  }
  if (!probe.mainBuffer.available || !probe.mainBuffer.containsMarker) {
    return 'pty-backend-not-echoing'
  }
  if (!probe.pane.serializedContainsMarker) {
    return 'xterm-buffer-not-updating'
  }
  return 'terminal-layer-healthy'
}

type ProbeOptions = {
  marker?: string
  commandTimeoutMs?: number
  pollIntervalMs?: number
}

const DEFAULT_COMMAND_TIMEOUT_MS = 2_000
const DEFAULT_POLL_INTERVAL_MS = 50

function makeMarker(): string {
  return `ORCA_TERMINAL_LIVENESS_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

export async function probeActiveTerminalLiveness(
  page: Page,
  options: ProbeOptions = {}
): Promise<TerminalLivenessProbe> {
  const marker = options.marker ?? makeMarker()
  const initial = await readActiveTerminalLivenessSnapshot(page, marker)
  if (!initial.pane.ptyId) {
    return initial
  }

  const start = performance.now()
  await page.evaluate(
    ({ ptyId, marker }) => {
      window.api.pty.write(ptyId, `printf '\\n${marker}\\n'\r`)
    },
    { ptyId: initial.pane.ptyId, marker }
  )

  const timeoutMs = options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  let latest = await readActiveTerminalLivenessSnapshot(page, marker)
  while (performance.now() - start < timeoutMs) {
    if (latest.mainBuffer.containsMarker && latest.pane.serializedContainsMarker) {
      return { ...latest, elapsedMs: performance.now() - start }
    }
    await page.waitForTimeout(pollIntervalMs)
    latest = await readActiveTerminalLivenessSnapshot(page, marker)
  }
  return { ...latest, elapsedMs: null }
}

export async function readActiveTerminalLivenessSnapshot(
  page: Page,
  marker: string
): Promise<TerminalLivenessProbe> {
  return page.evaluate(async (marker) => {
    const store = window.__store ?? null
    const state = store?.getState?.() ?? null
    const worktreeId = state?.activeWorktreeId ?? null
    const tabs = worktreeId ? (state?.tabsByWorktree?.[worktreeId] ?? []) : []
    const preferredTabId =
      state?.activeTabType === 'terminal'
        ? (state.activeTabId ?? null)
        : worktreeId
          ? (state?.activeTabIdByWorktree?.[worktreeId] ?? null)
          : null
    const tabId =
      preferredTabId && tabs.some((tab) => tab.id === preferredTabId)
        ? preferredTabId
        : (tabs[0]?.id ?? null)
    const manager = tabId ? (window.__paneManagers?.get(tabId) ?? null) : null
    const activePane = manager?.getActivePane?.() ?? manager?.getPanes?.()[0] ?? null
    const ptyId = activePane?.container?.dataset?.ptyId ?? null
    const serialized = activePane?.serializeAddon?.serialize?.({ scrollback: 200 }) ?? ''
    const textarea = activePane?.container?.querySelector?.('.xterm-helper-textarea') ?? null
    const diagnostics = manager?.getRenderingDiagnostics?.() ?? []
    const schedulerDebug = window.__terminalOutputSchedulerDebug?.snapshot?.() ?? null

    let mainBufferAvailable = false
    let mainBufferTail = ''
    if (ptyId) {
      try {
        const snapshot = await window.api.pty.getMainBufferSnapshot(ptyId, {
          scrollbackRows: 200
        })
        mainBufferAvailable = Boolean(snapshot)
        mainBufferTail = snapshot?.data?.slice(-4000) ?? ''
      } catch {
        mainBufferAvailable = false
      }
    }

    return {
      marker,
      elapsedMs: null,
      worktreeId,
      tabId,
      pane: {
        exists: Boolean(activePane),
        paneId: activePane?.id ?? null,
        leafId: activePane?.leafId ?? null,
        ptyId,
        serializedTail: serialized.slice(-4000),
        serializedContainsMarker: serialized.includes(marker),
        textareaFocused: document.activeElement === textarea,
        canvasCount: activePane?.container?.querySelectorAll?.('canvas')?.length ?? 0,
        xtermElementConnected: Boolean(activePane?.terminal?.element?.isConnected)
      },
      store: {
        ptyIdsForTab: tabId ? (state?.ptyIdsByTabId?.[tabId] ?? []) : [],
        activeTabType: state?.activeTabType ?? null
      },
      mainBuffer: {
        available: mainBufferAvailable,
        containsMarker: mainBufferTail.includes(marker),
        tail: mainBufferTail
      },
      renderingDiagnostics: diagnostics,
      schedulerDebug
    }
  }, marker)
}

import type { Page } from '@stablyai/playwright-test'
import { randomUUID } from 'node:crypto'
import { rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test, expect } from './helpers/orca-app'
import {
  ensureTerminalVisible,
  getActiveWorktreeId,
  getAllWorktreeIds,
  switchToWorktree,
  waitForActiveWorktree,
  waitForSessionReady
} from './helpers/store'
import {
  focusActiveTerminalInput,
  sendToTerminal,
  splitActiveTerminalPane,
  waitForActivePanePtyId,
  waitForActiveTerminalManager,
  waitForPaneIdentitySnapshot
} from './helpers/terminal'
import {
  classifyTerminalLivenessProbe,
  probeActiveTerminalLiveness,
  type TerminalLivenessClassification
} from './helpers/terminal-liveness-diagnostics'

type BackgroundPressureSnapshot = {
  probeIndex: number
  elapsedMs: number | null
  worktreeId: string | null
  tabId: string | null
  paneCount: number
  pressurePaneCount: number
  pressureOutputMiB: number
  appRendererMemoryMiB: number | null
  appTotalMemoryMiB: number | null
  classification: TerminalLivenessClassification
  mainBufferContainsMarker: boolean
  xtermContainsMarker: boolean
  hasWebgl: boolean
  webglDisabledAfterContextLoss: boolean
  schedulerQueuedChars: number | null
  schedulerPeakQueuedChars: number | null
  mainPendingChars: number | null
  mainRendererInFlightChars: number | null
  hiddenHeadlessPtyCount: number | null
  deferredHeadlessPtyCount: number | null
  deferredHeadlessChars: number | null
  maxDeferredHeadlessCharsByPty: number | null
  activePtyId: string | null
}

const DEFAULT_PANE_COUNT = 8
const DEFAULT_PRESSURE_MIB_PER_PANE = 4
const DEFAULT_PROBE_COUNT = 4

function readPositiveIntEnv(name: string, fallback: number): number {
  const value = process.env[name]
  if (!value) {
    return fallback
  }
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function pressureOutputScript(runId: string): string {
  return `
const paneIndex = process.argv[2] ?? '0'
const targetChars = Number(process.argv[3] ?? '0')
const chunkBody = '#'.repeat(8192)
let written = 0
process.stdout.write('ORCA_BG_PRESSURE_START_${runId}_' + paneIndex + '\\n')
function writeMore() {
  let canContinue = true
  while (canContinue && written < targetChars) {
    const frame = String(written).padStart(8, '0')
    const chunk = '\\x1b[?2026h\\x1b[1;1Hbackground pane=' + paneIndex + ' frame=' + frame + ' ' + chunkBody + '\\x1b[?2026l\\n'
    written += chunk.length
    canContinue = process.stdout.write(chunk)
  }
  if (written < targetChars) {
    process.stdout.once('drain', writeMore)
    return
  }
  process.stdout.write('ORCA_BG_PRESSURE_DONE_${runId}_' + paneIndex + '\\n')
}
writeMore()
`
}

async function ensurePaneCount(
  page: Page,
  paneCount: number
): Promise<Awaited<ReturnType<typeof waitForPaneIdentitySnapshot>>> {
  let snapshot = await waitForPaneIdentitySnapshot(page, 1)
  while (snapshot.panes.length < paneCount) {
    await splitActiveTerminalPane(page, snapshot.panes.length % 2 === 0 ? 'horizontal' : 'vertical')
    snapshot = await waitForPaneIdentitySnapshot(page, snapshot.panes.length + 1)
  }
  return snapshot
}

async function focusPane(page: Page, tabId: string, leafId: string): Promise<void> {
  await page.evaluate(
    ({ tabId, leafId }) => {
      const manager = window.__paneManagers?.get(tabId)
      const pane = manager?.getPanes?.().find((candidate) => candidate.leafId === leafId)
      if (!manager || !pane) {
        throw new Error(`Unable to focus pane ${tabId}:${leafId}`)
      }
      manager.setActivePane(pane.id, { focus: true })
    },
    { tabId, leafId }
  )
}

async function resetDebugCounters(page: Page): Promise<void> {
  await page.evaluate(async () => {
    window.__terminalOutputSchedulerDebug?.reset?.()
    await window.api.pty.resetRendererDeliveryDebug()
  })
}

async function readResourceManagerAppMemory(page: Page): Promise<{
  appRendererMemoryMiB: number | null
  appTotalMemoryMiB: number | null
}> {
  return page.evaluate(async () => {
    try {
      const snapshot = await window.api.memory.getSnapshot()
      return {
        appRendererMemoryMiB: Math.round(snapshot.app.renderer.memory / 1024 / 1024),
        appTotalMemoryMiB: Math.round(snapshot.app.memory / 1024 / 1024)
      }
    } catch {
      return { appRendererMemoryMiB: null, appTotalMemoryMiB: null }
    }
  })
}

async function readMainPressureDebug(page: Page): Promise<{
  mainPendingChars: number | null
  mainRendererInFlightChars: number | null
  hiddenHeadlessPtyCount: number | null
  deferredHeadlessPtyCount: number | null
  deferredHeadlessChars: number | null
  maxDeferredHeadlessCharsByPty: number | null
}> {
  return page.evaluate(async () => {
    const snapshot = await window.api.pty.getRendererDeliveryDebugSnapshot()
    return {
      mainPendingChars: snapshot?.pendingChars ?? null,
      mainRendererInFlightChars: snapshot?.rendererInFlightChars ?? null,
      hiddenHeadlessPtyCount: snapshot?.hiddenHeadlessPtyCount ?? null,
      deferredHeadlessPtyCount: snapshot?.deferredHeadlessPtyCount ?? null,
      deferredHeadlessChars: snapshot?.deferredHeadlessChars ?? null,
      maxDeferredHeadlessCharsByPty: snapshot?.maxDeferredHeadlessCharsByPty ?? null
    }
  })
}

function readRenderingState(probe: Awaited<ReturnType<typeof probeActiveTerminalLiveness>>): {
  hasWebgl: boolean
  webglDisabledAfterContextLoss: boolean
} {
  const diagnostic = probe.renderingDiagnostics[0] as
    | { hasWebgl?: boolean; webglDisabledAfterContextLoss?: boolean }
    | undefined
  return {
    hasWebgl: diagnostic?.hasWebgl === true,
    webglDisabledAfterContextLoss: diagnostic?.webglDisabledAfterContextLoss === true
  }
}

function readSchedulerState(probe: Awaited<ReturnType<typeof probeActiveTerminalLiveness>>): {
  schedulerQueuedChars: number | null
  schedulerPeakQueuedChars: number | null
} {
  const scheduler = probe.schedulerDebug as {
    queuedChars?: unknown
    peakQueuedChars?: unknown
  } | null
  return {
    schedulerQueuedChars: typeof scheduler?.queuedChars === 'number' ? scheduler.queuedChars : null,
    schedulerPeakQueuedChars:
      typeof scheduler?.peakQueuedChars === 'number' ? scheduler.peakQueuedChars : null
  }
}

test.describe('Terminal liveness during background pane pressure @headful', () => {
  test('keeps the active terminal classified while sibling panes stream output', async ({
    orcaPage,
    testRepoPath
  }, testInfo) => {
    test.skip(
      process.env.ORCA_E2E_TERMINAL_BACKGROUND_PRESSURE !== '1',
      'Set ORCA_E2E_TERMINAL_BACKGROUND_PRESSURE=1 to run the background terminal pressure probe'
    )
    test.setTimeout(240_000)

    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
    await ensureTerminalVisible(orcaPage)
    await waitForActiveTerminalManager(orcaPage, 30_000)
    await waitForActivePanePtyId(orcaPage, 30_000)

    const paneCount = readPositiveIntEnv('ORCA_E2E_TERMINAL_BACKGROUND_PANES', DEFAULT_PANE_COUNT)
    const pressureMiB = readPositiveIntEnv(
      'ORCA_E2E_TERMINAL_BACKGROUND_PRESSURE_MIB_PER_PANE',
      DEFAULT_PRESSURE_MIB_PER_PANE
    )
    const probeCount = readPositiveIntEnv(
      'ORCA_E2E_TERMINAL_BACKGROUND_PROBES',
      DEFAULT_PROBE_COUNT
    )
    const livenessTimeoutMs = readPositiveIntEnv('ORCA_E2E_TERMINAL_LIVENESS_TIMEOUT_MS', 2_000)
    const pressureOutputChars = pressureMiB * 1024 * 1024
    const runId = randomUUID()
    const scriptPath = path.join(testRepoPath, `.orca-bg-pressure-${runId}.mjs`)
    writeFileSync(scriptPath, pressureOutputScript(runId))

    const snapshots: BackgroundPressureSnapshot[] = []
    try {
      const layout = await ensurePaneCount(orcaPage, paneCount)
      const [activePane, ...pressurePanes] = layout.panes
      if (!activePane?.ptyId) {
        throw new Error('Active pane has no PTY')
      }
      await focusPane(orcaPage, layout.tabId, activePane.leafId)
      await focusActiveTerminalInput(orcaPage)
      await resetDebugCounters(orcaPage)

      await Promise.all(
        pressurePanes.map((pane, paneIndex) => {
          if (!pane.ptyId) {
            throw new Error(`Pressure pane ${pane.leafId} has no PTY`)
          }
          return sendToTerminal(
            orcaPage,
            pane.ptyId,
            `node ${JSON.stringify(scriptPath)} ${paneIndex} ${pressureOutputChars}\r`
          )
        })
      )

      for (let probeIndex = 1; probeIndex <= probeCount; probeIndex += 1) {
        await orcaPage.waitForTimeout(250)
        await focusPane(orcaPage, layout.tabId, activePane.leafId)
        const probe = await probeActiveTerminalLiveness(orcaPage, {
          marker: `ORCA_BG_LIVENESS_${probeIndex}_${Date.now()}`,
          commandTimeoutMs: livenessTimeoutMs
        })
        const memory = await readResourceManagerAppMemory(orcaPage)
        const mainPressure = await readMainPressureDebug(orcaPage)
        const rendering = readRenderingState(probe)
        const scheduler = readSchedulerState(probe)
        snapshots.push({
          probeIndex,
          elapsedMs: probe.elapsedMs === null ? null : Math.round(probe.elapsedMs * 10) / 10,
          worktreeId: probe.worktreeId,
          tabId: probe.tabId,
          paneCount: layout.panes.length,
          pressurePaneCount: pressurePanes.length,
          pressureOutputMiB: pressureMiB,
          ...memory,
          classification: classifyTerminalLivenessProbe(probe),
          mainBufferContainsMarker: probe.mainBuffer.containsMarker,
          xtermContainsMarker: probe.pane.serializedContainsMarker,
          ...rendering,
          ...scheduler,
          ...mainPressure,
          activePtyId: probe.pane.ptyId
        })
      }
    } finally {
      await sendToTerminal(orcaPage, await waitForActivePanePtyId(orcaPage), '\x03').catch(
        () => undefined
      )
      rmSync(scriptPath, { force: true })
    }

    const summary = JSON.stringify(snapshots)
    process.stdout.write(`\n[terminal-background-pressure] ${summary}\n`)
    testInfo.annotations.push({ type: 'terminal-background-pressure', description: summary })

    expect(snapshots.map((snapshot) => snapshot.classification)).toEqual(
      Array.from({ length: probeCount }, () => 'terminal-layer-healthy')
    )
  })

  test('keeps active workspace terminal classified while another workspace streams output', async ({
    orcaPage,
    testRepoPath
  }, testInfo) => {
    test.skip(
      process.env.ORCA_E2E_TERMINAL_CROSS_WORKSPACE_PRESSURE !== '1',
      'Set ORCA_E2E_TERMINAL_CROSS_WORKSPACE_PRESSURE=1 to run the cross-workspace pressure probe'
    )
    test.setTimeout(240_000)

    await waitForSessionReady(orcaPage)
    const firstWorktreeId = await waitForActiveWorktree(orcaPage)
    const allWorktreeIds = await getAllWorktreeIds(orcaPage)
    const secondWorktreeId = allWorktreeIds.find((id) => id !== firstWorktreeId)
    test.skip(!secondWorktreeId, 'Cross-workspace pressure probe needs the seeded second worktree')
    if (!secondWorktreeId) {
      return
    }

    const paneCount = readPositiveIntEnv('ORCA_E2E_TERMINAL_BACKGROUND_PANES', DEFAULT_PANE_COUNT)
    const pressureMiB = readPositiveIntEnv(
      'ORCA_E2E_TERMINAL_BACKGROUND_PRESSURE_MIB_PER_PANE',
      DEFAULT_PRESSURE_MIB_PER_PANE
    )
    const probeCount = readPositiveIntEnv(
      'ORCA_E2E_TERMINAL_BACKGROUND_PROBES',
      DEFAULT_PROBE_COUNT
    )
    const livenessTimeoutMs = readPositiveIntEnv('ORCA_E2E_TERMINAL_LIVENESS_TIMEOUT_MS', 2_000)
    const pressureOutputChars = pressureMiB * 1024 * 1024
    const runId = randomUUID()
    const scriptPath = path.join(testRepoPath, `.orca-cross-pressure-${runId}.mjs`)
    writeFileSync(scriptPath, pressureOutputScript(runId))
    const snapshots: BackgroundPressureSnapshot[] = []

    try {
      await switchToWorktree(orcaPage, secondWorktreeId)
      await expect
        .poll(() => getActiveWorktreeId(orcaPage), { timeout: 10_000 })
        .toBe(secondWorktreeId)
      await ensureTerminalVisible(orcaPage)
      await waitForActiveTerminalManager(orcaPage, 30_000)
      await waitForActivePanePtyId(orcaPage, 30_000)
      const hiddenLayout = await ensurePaneCount(orcaPage, paneCount)
      await resetDebugCounters(orcaPage)

      await Promise.all(
        hiddenLayout.panes.map((pane, paneIndex) => {
          if (!pane.ptyId) {
            throw new Error(`Pressure pane ${pane.leafId} has no PTY`)
          }
          return sendToTerminal(
            orcaPage,
            pane.ptyId,
            `node ${JSON.stringify(scriptPath)} ${paneIndex} ${pressureOutputChars}\r`
          )
        })
      )

      await switchToWorktree(orcaPage, firstWorktreeId)
      await expect
        .poll(() => getActiveWorktreeId(orcaPage), { timeout: 10_000 })
        .toBe(firstWorktreeId)
      await ensureTerminalVisible(orcaPage)
      await waitForActiveTerminalManager(orcaPage, 30_000)
      await waitForActivePanePtyId(orcaPage, 30_000)

      for (let probeIndex = 1; probeIndex <= probeCount; probeIndex += 1) {
        await orcaPage.waitForTimeout(250)
        const probe = await probeActiveTerminalLiveness(orcaPage, {
          marker: `ORCA_CROSS_BG_LIVENESS_${probeIndex}_${Date.now()}`,
          commandTimeoutMs: livenessTimeoutMs
        })
        const memory = await readResourceManagerAppMemory(orcaPage)
        const mainPressure = await readMainPressureDebug(orcaPage)
        const rendering = readRenderingState(probe)
        const scheduler = readSchedulerState(probe)
        snapshots.push({
          probeIndex,
          elapsedMs: probe.elapsedMs === null ? null : Math.round(probe.elapsedMs * 10) / 10,
          worktreeId: probe.worktreeId,
          tabId: probe.tabId,
          paneCount: hiddenLayout.panes.length + 1,
          pressurePaneCount: hiddenLayout.panes.length,
          pressureOutputMiB: pressureMiB,
          ...memory,
          classification: classifyTerminalLivenessProbe(probe),
          mainBufferContainsMarker: probe.mainBuffer.containsMarker,
          xtermContainsMarker: probe.pane.serializedContainsMarker,
          ...rendering,
          ...scheduler,
          ...mainPressure,
          activePtyId: probe.pane.ptyId
        })
      }
    } finally {
      rmSync(scriptPath, { force: true })
    }

    const summary = JSON.stringify(snapshots)
    process.stdout.write(`\n[terminal-cross-workspace-pressure] ${summary}\n`)
    testInfo.annotations.push({ type: 'terminal-cross-workspace-pressure', description: summary })

    expect(snapshots.map((snapshot) => snapshot.classification)).toEqual(
      Array.from({ length: probeCount }, () => 'terminal-layer-healthy')
    )
    expect(snapshots.every((snapshot) => snapshot.worktreeId === firstWorktreeId)).toBe(true)
  })
})

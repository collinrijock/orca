import type { Page, TestInfo } from '@stablyai/playwright-test'
import { expect } from '@stablyai/playwright-test'
import { randomUUID } from 'node:crypto'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from './helpers/orca-app'
import {
  ensureTerminalVisible,
  getActiveWorktreeId,
  getAllWorktreeIds,
  switchToWorktree,
  waitForActiveWorktree,
  waitForSessionReady
} from './helpers/store'
import {
  getTerminalContent,
  sendToTerminal,
  waitForActiveTerminalManager,
  waitForPaneIdentitySnapshot
} from './helpers/terminal'

type RestoreFrameSample = {
  index: number
  timestampMs: number
  elapsedMs: number
  active: boolean
  hasPane: boolean
  paneVisible: boolean
  hasBaseline: boolean
  hasFinalMarker: boolean
  lastBurstLine: number | null
  textLength: number
  baseY: number | null
  viewportY: number | null
  cursorY: number | null
  preview: string
}

type RestoreFrameRecorder = {
  done: boolean
  samples: RestoreFrameSample[]
}

type RestoreFrameRecorderWindow = Window & {
  __hiddenRestoreFrameRecorder?: RestoreFrameRecorder
}

const HIDDEN_BURST_LINE_COUNT = 1000
const FRAME_SAMPLE_COUNT = 18

function hiddenBurstLine(runId: string, line: number): string {
  return `HIDDEN_RESTORE_${runId}_${String(line).padStart(4, '0')}`
}

function writeHiddenBurstScript(
  scriptPath: string,
  donePath: string,
  runId: string,
  lineCount: number
): void {
  const lines = Array.from({ length: lineCount }, (_, index) => hiddenBurstLine(runId, index + 1))
  writeFileSync(
    scriptPath,
    [
      "const { writeFileSync } = require('node:fs')",
      `const lines = ${JSON.stringify(lines)}`,
      "process.stdout.write(`${lines.join('\\n')}\\n`, () => {",
      `  writeFileSync(${JSON.stringify(donePath)}, 'done')`,
      '})'
    ].join('\n')
  )
}

async function startRestoreFrameRecorder(
  page: Page,
  targetWorktreeId: string,
  runId: string,
  baselineMarker: string,
  finalMarker: string
): Promise<void> {
  await page.evaluate(
    ({ targetWorktreeId, runId, baselineMarker, finalMarker, sampleCount }) => {
      const target = window as RestoreFrameRecorderWindow
      const recorder: RestoreFrameRecorder = { done: false, samples: [] }
      target.__hiddenRestoreFrameRecorder = recorder
      let observedTargetWorkspace = false
      let sampleIndex = 0
      const startedAt = performance.now()
      const linePrefix = `HIDDEN_RESTORE_${runId}_`

      const readLastBurstLine = (text: string): number | null => {
        let last: number | null = null
        let index = text.indexOf(linePrefix)
        while (index >= 0) {
          const start = index + linePrefix.length
          const parsed = Number(text.slice(start, start + 4))
          if (Number.isInteger(parsed)) {
            last = parsed
          }
          index = text.indexOf(linePrefix, start)
        }
        return last
      }

      const isElementVisible = (element: HTMLElement | null | undefined): boolean => {
        if (!element) {
          return false
        }
        const rect = element.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) {
          return false
        }
        let current: HTMLElement | null = element
        while (current) {
          const style = window.getComputedStyle(current)
          if (
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            Number(style.opacity) === 0
          ) {
            return false
          }
          current = current.parentElement
        }
        return true
      }

      const collectSample = (): void => {
        const timestampMs = performance.now()
        const store = window.__store
        const state = store?.getState()
        const active = state?.activeWorktreeId === targetWorktreeId
        observedTargetWorkspace ||= active

        if (active || observedTargetWorkspace) {
          const tabId =
            state?.activeTabType === 'terminal'
              ? state.activeTabId
              : targetWorktreeId
                ? (state?.activeTabIdByWorktree?.[targetWorktreeId] ?? null)
                : null
          const manager = tabId ? window.__paneManagers?.get(tabId) : null
          const pane = manager?.getActivePane?.() ?? manager?.getPanes?.()[0] ?? null
          const text = pane?.serializeAddon?.serialize?.() ?? ''
          const buffer = pane?.terminal?.buffer?.active
          recorder.samples.push({
            index: sampleIndex,
            timestampMs,
            elapsedMs: timestampMs - startedAt,
            active,
            hasPane: Boolean(pane),
            paneVisible: isElementVisible(pane?.container),
            hasBaseline: text.includes(baselineMarker),
            hasFinalMarker: text.includes(finalMarker),
            lastBurstLine: readLastBurstLine(text),
            textLength: text.length,
            baseY: typeof buffer?.baseY === 'number' ? buffer.baseY : null,
            viewportY: typeof buffer?.viewportY === 'number' ? buffer.viewportY : null,
            cursorY: typeof buffer?.cursorY === 'number' ? buffer.cursorY : null,
            preview: text.slice(-240)
          })
          sampleIndex += 1
        }

        if (sampleIndex >= sampleCount) {
          recorder.done = true
          return
        }
        requestAnimationFrame(collectSample)
      }

      requestAnimationFrame(collectSample)
    },
    { targetWorktreeId, runId, baselineMarker, finalMarker, sampleCount: FRAME_SAMPLE_COUNT }
  )
}

async function readRestoreFrameRecorder(page: Page): Promise<RestoreFrameRecorder> {
  return page.evaluate(() => {
    return (
      (window as RestoreFrameRecorderWindow).__hiddenRestoreFrameRecorder ?? {
        done: false,
        samples: []
      }
    )
  })
}

async function attachRestoreFrameSamples(
  testInfo: TestInfo,
  samples: RestoreFrameSample[]
): Promise<void> {
  const samplesPath = testInfo.outputPath('hidden-restore-frame-samples.json')
  writeFileSync(samplesPath, `${JSON.stringify(samples, null, 2)}\n`)
  await testInfo.attach('hidden-restore-frame-samples.json', {
    path: samplesPath,
    contentType: 'application/json'
  })
}

test.describe('Hidden terminal restore catch-up artifacts', () => {
  test('blanks stale renderer content before showing a 1000-line hidden burst restored', async ({
    orcaPage,
    testRepoPath
  }, testInfo) => {
    await waitForSessionReady(orcaPage)
    const firstWorktreeId = await waitForActiveWorktree(orcaPage)
    const secondWorktreeId = (await getAllWorktreeIds(orcaPage)).find(
      (id) => id !== firstWorktreeId
    )
    test.skip(!secondWorktreeId, 'hidden restore catch-up guard needs a second worktree')
    if (!secondWorktreeId) {
      return
    }

    await switchToWorktree(orcaPage, secondWorktreeId)
    await ensureTerminalVisible(orcaPage)
    await waitForActiveTerminalManager(orcaPage, 30_000)
    const hiddenSnapshot = await waitForPaneIdentitySnapshot(orcaPage, 1)
    const hiddenPane = hiddenSnapshot.panes[0]
    if (!hiddenPane?.ptyId) {
      throw new Error('hidden restore catch-up pane did not bind a PTY')
    }
    const runId = randomUUID()
    const baselineMarker = `VISIBLE_BEFORE_HIDDEN_RESTORE_${runId}`
    await sendToTerminal(
      orcaPage,
      hiddenPane.ptyId,
      `printf '%s\\n' ${JSON.stringify(baselineMarker)}\r`
    )
    await expect
      .poll(() => getTerminalContent(orcaPage, 20_000), {
        timeout: 10_000,
        message: 'baseline terminal content did not render before hiding'
      })
      .toContain(baselineMarker)

    await switchToWorktree(orcaPage, firstWorktreeId)
    await expect
      .poll(() => getActiveWorktreeId(orcaPage), {
        timeout: 10_000,
        message: 'first worktree did not become active before hidden burst'
      })
      .toBe(firstWorktreeId)

    const scriptPath = path.join(testRepoPath, `.orca-hidden-restore-burst-${runId}.cjs`)
    const donePath = path.join(testRepoPath, `.orca-hidden-restore-burst-${runId}.done`)
    const firstLine = hiddenBurstLine(runId, 1)
    const finalMarker = hiddenBurstLine(runId, HIDDEN_BURST_LINE_COUNT)
    writeHiddenBurstScript(scriptPath, donePath, runId, HIDDEN_BURST_LINE_COUNT)

    await orcaPage.evaluate(() => window.api.pty.resetRendererDeliveryDebug())
    await sendToTerminal(orcaPage, hiddenPane.ptyId, `node ${JSON.stringify(scriptPath)}\r`)

    await expect
      .poll(() => existsSync(donePath), {
        timeout: 10_000,
        message: 'hidden 1000-line burst script did not finish'
      })
      .toBe(true)

    await expect
      .poll(
        async () => {
          const snapshot = await orcaPage.evaluate(() =>
            window.api.pty.getRendererDeliveryDebugSnapshot()
          )
          return snapshot.deferredHeadlessChars
        },
        {
          timeout: 10_000,
          message: 'hidden burst did not exercise deferred headless restore path'
        }
      )
      .toBeGreaterThan(20_000)

    await startRestoreFrameRecorder(orcaPage, secondWorktreeId, runId, baselineMarker, finalMarker)
    await switchToWorktree(orcaPage, secondWorktreeId)
    await ensureTerminalVisible(orcaPage)
    await waitForActiveTerminalManager(orcaPage, 30_000)

    await expect
      .poll(() => readRestoreFrameRecorder(orcaPage).then((recorder) => recorder.done), {
        timeout: 10_000,
        message: 'hidden restore frame recorder did not collect visible samples'
      })
      .toBe(true)

    const recorder = await readRestoreFrameRecorder(orcaPage)
    await attachRestoreFrameSamples(testInfo, recorder.samples)
    const visibleSamples = recorder.samples.filter((sample) => sample.active && sample.paneVisible)
    expect(visibleSamples.length).toBeGreaterThanOrEqual(6)

    const staleSamples = visibleSamples.filter(
      (sample) => sample.hasBaseline && !sample.hasFinalMarker && sample.lastBurstLine === null
    )
    expect(staleSamples, JSON.stringify(staleSamples, null, 2)).toEqual([])

    const partialCatchupSamples = visibleSamples.filter(
      (sample) => sample.lastBurstLine !== null && sample.lastBurstLine !== HIDDEN_BURST_LINE_COUNT
    )
    expect(partialCatchupSamples, JSON.stringify(partialCatchupSamples, null, 2)).toEqual([])

    const firstRestoredFrameIndex = visibleSamples.findIndex(
      (sample) => sample.hasFinalMarker && sample.lastBurstLine === HIDDEN_BURST_LINE_COUNT
    )
    expect(firstRestoredFrameIndex).toBeGreaterThanOrEqual(0)

    const preRestoreSamples = visibleSamples.slice(0, firstRestoredFrameIndex)
    const nonBlankPreRestoreSamples = preRestoreSamples.filter(
      (sample) => sample.textLength > 128 || sample.lastBurstLine !== null || sample.hasFinalMarker
    )
    expect(nonBlankPreRestoreSamples, JSON.stringify(nonBlankPreRestoreSamples, null, 2)).toEqual(
      []
    )

    const postRestoreIncompleteSamples = visibleSamples
      .slice(firstRestoredFrameIndex)
      .filter(
        (sample) => !sample.hasFinalMarker || sample.lastBurstLine !== HIDDEN_BURST_LINE_COUNT
      )
    expect(
      postRestoreIncompleteSamples,
      JSON.stringify(postRestoreIncompleteSamples, null, 2)
    ).toEqual([])

    const finalContent = await getTerminalContent(orcaPage, 200_000)
    expect(finalContent).toContain(firstLine)
    expect(finalContent).toContain(finalMarker)
    expect(finalContent).not.toContain('Orca skipped hidden terminal output')

    rmSync(scriptPath, { force: true })
    rmSync(donePath, { force: true })
  })
})

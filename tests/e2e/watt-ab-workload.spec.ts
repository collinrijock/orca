/**
 * Watt-level A/B workload driver (manual harness, never runs in CI: it is
 * skipped unless WATT_AB_PHASE is set and @headful excludes it from the
 * headless suite).
 *
 * Launches the real app headful, streams ~250 tiny PTY chunks/s through a
 * visible terminal for WATT_AB_SECONDS, and writes a sentinel file when the
 * stream starts so an external process-energy sampler can align its window.
 * Run via config/scripts/terminal-output-watt-ab-macos.sh.
 */

import { writeFileSync } from 'node:fs'
import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import {
  ensureTerminalVisible,
  getActiveTabId,
  waitForActiveWorktree,
  waitForSessionReady
} from './helpers/store'
import { getTerminalContent, waitForActiveTerminalManager } from './helpers/terminal'

const WORKLOAD_SECONDS = Number(process.env.WATT_AB_SECONDS ?? '90')
const PHASE = process.env.WATT_AB_PHASE ?? 'phase'
const CHUNK_INTERVAL_MS = 4

async function waitForTabPtyId(page: Page, tabId: string): Promise<string> {
  let ptyId: string | null = null
  await expect
    .poll(
      async () => {
        ptyId = await page.evaluate((targetTabId) => {
          const manager = (
            window as Window & {
              __paneManagers?: Map<string, { getPanes?: () => { container?: HTMLElement }[] }>
            }
          ).__paneManagers?.get(targetTabId)
          const pane = manager?.getPanes?.()[0] ?? null
          return pane?.container?.dataset?.ptyId ?? null
        }, tabId)
        return ptyId
      },
      { timeout: 30_000, message: 'Active tab never exposed a ptyId' }
    )
    .not.toBeNull()
  if (!ptyId) {
    throw new Error('ptyId unavailable')
  }
  return ptyId
}

test.describe('watt A/B workload', () => {
  test.skip(
    !process.env.WATT_AB_PHASE,
    'manual energy harness — run via config/scripts/terminal-output-watt-ab-macos.sh'
  )

  test('streams passive tiny chunks through a visible terminal @headful', async ({ orcaPage }) => {
    test.setTimeout(WORKLOAD_SECONDS * 1000 + 180_000)
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
    await ensureTerminalVisible(orcaPage)
    await waitForActiveTerminalManager(orcaPage, 30_000)

    const tabId = await getActiveTabId(orcaPage)
    if (!tabId) {
      throw new Error('No active terminal tab')
    }
    const ptyId = await waitForTabPtyId(orcaPage, tabId)

    const durationMs = WORKLOAD_SECONDS * 1000
    // Why the split literals: the shell echoes the typed command line into the
    // terminal, so the markers must only exist assembled at runtime.
    const command =
      `node -e 'const s=Date.now();const iv=setInterval(()=>{` +
      `process.stdout.write("ti"+"ckmark "+(Date.now()-s)+" abcdefghijklmnopqrstuvwxyz0123456789\\n");` +
      `if(Date.now()-s>${durationMs}){clearInterval(iv);console.log("WATT_AB_"+"DONE");process.exit(0)}` +
      `},${CHUNK_INTERVAL_MS});'`
    await orcaPage.evaluate(
      ({ targetPtyId, cmd }) => {
        window.api.pty.write(targetPtyId, `${cmd}\r`)
      },
      { targetPtyId: ptyId, cmd: command }
    )

    await expect
      .poll(async () => (await getTerminalContent(orcaPage, 10_000)).includes('tickmark '), {
        timeout: 30_000,
        message: 'Workload stream never started'
      })
      .toBe(true)
    writeFileSync(`/tmp/watt-ab-started-${PHASE}`, String(Date.now()))

    await expect
      .poll(async () => (await getTerminalContent(orcaPage, 10_000)).includes('WATT_AB_DONE'), {
        timeout: durationMs + 60_000,
        intervals: [5_000],
        message: 'Workload stream never finished'
      })
      .toBe(true)
    writeFileSync(`/tmp/watt-ab-finished-${PHASE}`, String(Date.now()))
  })
})

import type { Page } from '@stablyai/playwright-test'

import { connectDockerSshRelayTarget } from './helpers/docker-ssh-relay-connection'
import { readDockerSshRelayNodePath } from './helpers/docker-ssh-relay-processes'
import {
  cleanupDockerSshRelayTarget,
  configureDockerSshNodeToolchainFixture,
  execDockerSshRelayTargetCommand,
  startDockerSshRelayTarget,
  type DockerSshRelayTarget
} from './helpers/docker-ssh-relay-target'
import { test, expect } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  execInTerminal,
  waitForActivePanePtyId,
  waitForActiveTerminalManager
} from './helpers/terminal'

const RUN_DOCKER_SSH = process.env.ORCA_E2E_SSH_DOCKER === '1'

async function enableTerminalAccessibilityDom(page: Page, ptyId: string): Promise<void> {
  await page.evaluate((id) => {
    const pane = Array.from(window.__paneManagers?.values() ?? [])
      .flatMap((manager) => manager.getPanes?.() ?? [])
      .find((candidate) => candidate.container.dataset.ptyId === id)
    if (!pane) {
      throw new Error(`Terminal pane ${id} is unavailable`)
    }
    pane.terminal.options.screenReaderMode = true
    pane.terminal.refresh(0, pane.terminal.rows - 1)
  }, ptyId)
  await expect(
    page.locator(`[data-pty-id=${JSON.stringify(ptyId)}] .xterm-accessibility-tree`)
  ).toBeAttached({ timeout: 10_000 })
}

test.describe('SSH Node/npm toolchain resolution', () => {
  test.skip(!RUN_DOCKER_SSH, 'Set ORCA_E2E_SSH_DOCKER=1 to run Docker-backed SSH tests.')
  test.skip(process.platform === 'win32', 'The #8450 fixture requires a POSIX Docker host.')

  test('uses complete guarded NVM toolchain when Ubuntu system Node has no npm', async ({
    orcaPage
  }, testInfo) => {
    test.slow()
    const startedAt = Date.now()
    let target: DockerSshRelayTarget | null = null
    try {
      target = startDockerSshRelayTarget(testInfo)
      const fixture = configureDockerSshNodeToolchainFixture(target)
      const preconditions = execDockerSshRelayTargetCommand(
        target,
        [
          '[ "$(command -v node)" = /usr/bin/node ]',
          '! command -v npm >/dev/null 2>&1',
          '[ "$(bash -lc \'command -v node\')" = /usr/bin/node ]',
          `test -x '${fixture.nvmNodePath}'`,
          `test -x '${fixture.nvmNpmPath}'`,
          `printf '%s\\n' '${fixture.systemNodeVersion}' '${fixture.nodeVersion}' '${fixture.npmVersion}'`
        ].join(' && ')
      )
      expect(preconditions.split('\n')).toEqual([
        fixture.systemNodeVersion,
        fixture.nodeVersion,
        fixture.npmVersion
      ])

      await waitForSessionReady(orcaPage)
      await waitForActiveWorktree(orcaPage)
      await connectDockerSshRelayTarget(orcaPage, target)
      await ensureTerminalVisible(orcaPage, 45_000)
      await waitForActiveTerminalManager(orcaPage, 60_000)
      const ptyId = await waitForActivePanePtyId(orcaPage, 60_000)
      await enableTerminalAccessibilityDom(orcaPage, ptyId)

      await expect
        .poll(() => readDockerSshRelayNodePath(target!), {
          timeout: 30_000,
          message: 'relay did not launch with the complete NVM Node/npm toolchain'
        })
        .toBe(fixture.nvmNodePath)

      const marker = `SSH_NODE_TOOLCHAIN_OK_${Date.now()}`
      const encodedMarker = Buffer.from(marker).toString('base64')
      await execInTerminal(
        orcaPage,
        ptyId,
        `printf '%s' '${encodedMarker}' | base64 -d && printf '\\n'`
      )
      await expect(
        orcaPage.locator(`[data-pty-id=${JSON.stringify(ptyId)}] .xterm-accessibility-tree`)
      ).toContainText(marker, { timeout: 30_000 })

      const evidenceSummary =
        `remote=ubuntu-24.04 architecture=${process.arch} systemNode=${fixture.systemNodeVersion} ` +
        `nvmNode=${fixture.nodeVersion} npm=${fixture.npmVersion} selected=nvm ` +
        `relayPty=pass durationMs=${Date.now() - startedAt}`
      console.log(`[ssh-node-toolchain-resolution] ${evidenceSummary}`)
      testInfo.annotations.push({
        type: 'ssh-node-toolchain-resolution',
        description: evidenceSummary
      })
    } finally {
      cleanupDockerSshRelayTarget(target)
    }
  })
})

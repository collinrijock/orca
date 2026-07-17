import { describe, expect, it } from 'vitest'
import {
  findConflictingAppInstancePids,
  parseSameExecutablePids
} from './updater-conflicting-app-instances'

const ORCA_BIN = '/Applications/Orca.app/Contents/MacOS/Orca'

describe('parseSameExecutablePids', () => {
  it('matches other pids running the exact executable path', () => {
    const output = [
      `  100 ${ORCA_BIN}`,
      '  200 /Applications/Orca.app/Contents/Frameworks/Orca Helper.app/Contents/MacOS/Orca Helper',
      `  300 ${ORCA_BIN}`,
      '  400 /usr/sbin/cfprefsd'
    ].join('\n')

    expect(parseSameExecutablePids(output, ORCA_BIN, 100)).toEqual([300])
  })

  it('keeps executable paths containing spaces intact', () => {
    const binWithSpaces = '/Users/dev/My Apps/Orca.app/Contents/MacOS/Orca'
    const output = `  512 ${binWithSpaces}\n  513 ${binWithSpaces} Helper`

    expect(parseSameExecutablePids(output, binWithSpaces, 1)).toEqual([512])
  })

  it('ignores dev-shell noise and malformed rows', () => {
    const output = ['not-a-row', '  -5 /bin/zsh', `  42 ${ORCA_BIN}extra`].join('\n')

    expect(parseSameExecutablePids(output, ORCA_BIN, 1)).toEqual([])
  })
})

describe('findConflictingAppInstancePids', () => {
  it('reports other same-binary instances on darwin', async () => {
    const pids = await findConflictingAppInstancePids({
      platform: 'darwin',
      executablePath: ORCA_BIN,
      currentPid: 100,
      readProcessList: async () => `  100 ${ORCA_BIN}\n  777 ${ORCA_BIN}`
    })

    expect(pids).toEqual([777])
  })

  it('skips the check off darwin — Win/Linux installers own this', async () => {
    const pids = await findConflictingAppInstancePids({
      platform: 'win32',
      executablePath: ORCA_BIN,
      currentPid: 100,
      readProcessList: async () => `  777 ${ORCA_BIN}`
    })

    expect(pids).toEqual([])
  })

  it('fails open when the process table is unreadable', async () => {
    const pids = await findConflictingAppInstancePids({
      platform: 'darwin',
      executablePath: ORCA_BIN,
      currentPid: 100,
      readProcessList: async () => {
        throw new Error('ps timed out')
      }
    })

    expect(pids).toEqual([])
  })
})

import { afterEach, describe, expect, it } from 'vitest'
import {
  acquirePtySessionConnectAdmission,
  getPtySessionConnectAdmissionCountForTest
} from './pty-session-connect-admission'

describe('PTY session connect admission', () => {
  afterEach(() => {
    expect(getPtySessionConnectAdmissionCountForTest()).toBe(0)
  })

  it('serializes one session without blocking a different session', async () => {
    const releaseFirst = await acquirePtySessionConnectAdmission('same-id')
    let secondAdmitted = false
    const secondAdmission = acquirePtySessionConnectAdmission('same-id').then((release) => {
      secondAdmitted = true
      return release
    })
    const releaseDifferent = await acquirePtySessionConnectAdmission('different-id')

    await Promise.resolve()
    expect(secondAdmitted).toBe(false)
    expect(getPtySessionConnectAdmissionCountForTest()).toBe(2)

    releaseFirst()
    const releaseSecond = await secondAdmission
    releaseSecond()
    releaseDifferent()
  })

  it('releases every retained identity after repeated admissions', async () => {
    for (let index = 0; index < 100; index += 1) {
      const release = await acquirePtySessionConnectAdmission(`session-${index}`)
      release()
    }

    expect(getPtySessionConnectAdmissionCountForTest()).toBe(0)
  })
})

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isCodexSystemDefaultRealHomeEnabled } from './codex-real-home-flag'

const ENV_FLAG = 'ORCA_CODEX_SYSTEM_DEFAULT_REAL_HOME'
let previousEnvFlag: string | undefined

beforeEach(() => {
  previousEnvFlag = process.env[ENV_FLAG]
  delete process.env[ENV_FLAG]
})

afterEach(() => {
  if (previousEnvFlag === undefined) {
    delete process.env[ENV_FLAG]
  } else {
    process.env[ENV_FLAG] = previousEnvFlag
  }
})

describe('isCodexSystemDefaultRealHomeEnabled', () => {
  it('is OFF by default (undefined settings)', () => {
    expect(isCodexSystemDefaultRealHomeEnabled(undefined)).toBe(false)
    expect(isCodexSystemDefaultRealHomeEnabled(null)).toBe(false)
    expect(isCodexSystemDefaultRealHomeEnabled({})).toBe(false)
  })

  it('honors the settings flag when set to true', () => {
    expect(isCodexSystemDefaultRealHomeEnabled({ codexSystemDefaultRealHomeEnabled: true })).toBe(
      true
    )
    expect(isCodexSystemDefaultRealHomeEnabled({ codexSystemDefaultRealHomeEnabled: false })).toBe(
      false
    )
  })

  it('lets the env override force ON regardless of settings', () => {
    for (const raw of ['1', 'true', 'on', 'TRUE', ' On ']) {
      process.env[ENV_FLAG] = raw
      expect(
        isCodexSystemDefaultRealHomeEnabled({ codexSystemDefaultRealHomeEnabled: false })
      ).toBe(true)
    }
  })

  it('lets the env override force OFF regardless of settings', () => {
    for (const raw of ['0', 'false', 'off']) {
      process.env[ENV_FLAG] = raw
      expect(isCodexSystemDefaultRealHomeEnabled({ codexSystemDefaultRealHomeEnabled: true })).toBe(
        false
      )
    }
  })

  it('ignores an unrecognized env value and falls back to settings', () => {
    process.env[ENV_FLAG] = 'maybe'
    expect(isCodexSystemDefaultRealHomeEnabled({ codexSystemDefaultRealHomeEnabled: true })).toBe(
      true
    )
    expect(isCodexSystemDefaultRealHomeEnabled({ codexSystemDefaultRealHomeEnabled: false })).toBe(
      false
    )
  })
})

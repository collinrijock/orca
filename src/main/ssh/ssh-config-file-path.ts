import { homedir } from 'node:os'
import { join } from 'node:path'
import { resolveSshConfigHomePath } from './ssh-config-path-expansion'

// Why: the four SSH consumers (config import, `ssh -G`, system-ssh argv, and the
// ProxyJump `ssh -W` spawn) are pure functions deep in the connection stack.
// A tiny main-process holder lets settings flow in without threading a param
// through every caller; it is trivially resettable in unit tests.
let overridePath: string | undefined

/** Set from persisted settings at startup and on every settings change.
 *  Trims; empty/whitespace → undefined (treated as "use default"). */
export function setSshConfigFilePathOverride(path: string | undefined): void {
  const trimmed = path?.trim()
  overridePath = trimmed ? trimmed : undefined
}

/** Raw override (already trimmed), or undefined when using the default. Used to
 *  decide whether to pass `-F` at all so unset behavior stays byte-identical. */
export function getSshConfigFilePathOverride(): string | undefined {
  return overridePath
}

/** Effective, home-expanded path. Returns the override (via
 *  resolveSshConfigHomePath) when set, else join(homedir(), '.ssh', 'config'). */
export function getSshConfigFilePath(): string {
  if (overridePath) {
    return resolveSshConfigHomePath(overridePath)
  }
  return join(homedir(), '.ssh', 'config')
}

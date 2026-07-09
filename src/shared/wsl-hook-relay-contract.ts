// Shared contract between the Windows host and the guest-resident WSL
// agent-hook relay. Both sides derive paths/methods from here so the guest
// process and the host manager can never drift on where the relay lives,
// which JSON-RPC methods the fs bridge speaks, or which exit codes signal
// "reinstall me" vs "no usable node".
// See docs/agent-status-over-wsl.md (STA-1515).

/** Guest-side install dir for the relay bundle, relative to `$HOME`. */
export const WSL_HOOK_RELAY_DIR = '.orca-wsl/hook-relay'
export const WSL_HOOK_RELAY_BUNDLE_NAME = 'wsl-agent-hook-relay.js'
export const WSL_HOOK_RELAY_VERSION_FILE = '.version'

/** Host-expected bundle version, crossed into the guest launch script via
 *  WSLENV so a stale guest install is detected by the guest itself. */
export const WSL_HOOK_RELAY_VERSION_ENV = 'ORCA_WSL_HOOK_RELAY_VERSION'

/** Launch-script exit codes. 42 mirrors the SSH relay's handshake-mismatch
 *  convention: the host reinstalls the bundle and relaunches once. */
export const WSL_HOOK_RELAY_STALE_EXIT_CODE = 42
export const WSL_HOOK_RELAY_NO_NODE_EXIT_CODE = 43

/** JSON-RPC methods for the relay's home-scoped fs bridge. The host runs the
 *  unchanged SSH remote hook installers against these via an SFTP-shaped
 *  adapter, so hook installation rides the already-open stdio channel instead
 *  of per-file wsl.exe spawns. */
export const WSL_HOOK_FS_METHODS = {
  home: 'wslfs.home',
  readFile: 'wslfs.readFile',
  writeFile: 'wslfs.writeFile',
  stat: 'wslfs.stat',
  rename: 'wslfs.rename',
  unlink: 'wslfs.unlink',
  chmod: 'wslfs.chmod',
  readdir: 'wslfs.readdir',
  mkdir: 'wslfs.mkdir'
} as const

/** Result envelope for every fs-bridge method. Errors travel as data (not
 *  JSON-RPC faults) so the host adapter can map POSIX errno onto the ssh2
 *  status codes the shared installer error-classifiers already understand. */
export type WslFsFailure = { ok: false; errno: string; message: string }
export type WslFsResult<T extends object = object> = ({ ok: true } & T) | WslFsFailure

/** Where the guest relay publishes its endpoint file. Keyed by the WINDOWS
 *  hook port: stable per Orca instance (concurrent instances have distinct
 *  ports), deterministic on both sides of the boundary without a handshake. */
export function wslHookRelayEndpointDir(guestHome: string, windowsPort: number): string {
  const home = guestHome.endsWith('/') ? guestHome.slice(0, -1) : guestHome
  return `${home}/.orca-wsl/agent-hooks/port-${windowsPort}`
}

/** The guest is always POSIX, so the Windows host must name the guest's
 *  endpoint file explicitly — its own `getEndpointFileName()` would say
 *  `endpoint.cmd`. Matches the POSIX branch of that helper. */
export const WSL_HOOK_RELAY_ENDPOINT_FILE = 'endpoint.env'

export function wslHookRelayEndpointFilePath(guestHome: string, windowsPort: number): string {
  return `${wslHookRelayEndpointDir(guestHome, windowsPort)}/${WSL_HOOK_RELAY_ENDPOINT_FILE}`
}

// Argument parsing for `node run.mjs`.
//
// Two installer sources are accepted per side: a local path (--from/--to) or a
// GitHub release tag (--from-release/--to-release) that the harness downloads
// via `gh release download`. Exactly one profile (--expect) is required.

const VALID_PROFILES = new Set(['cold-restore', 'survival'])

const USAGE = `
win-update-e2e — packaged NSIS update proof harness (Windows only)

Usage:
  node tools/win-update-e2e/run.mjs --from <setup.exe> --to <setup.exe> --expect <profile> [options]
  node tools/win-update-e2e/run.mjs --from-release <tag> --to-release <tag> --expect <profile>

Installer source (version N, then N+1) — path or release tag on each side:
  --from <path>            Local orca-windows-setup.exe for the base version (N)
  --to <path>              Local orca-windows-setup.exe for the update (N+1)
  --from-release <tag>     Download N's setup asset via gh (e.g. v1.4.124-rc.9)
  --to-release <tag>       Download N+1's setup asset via gh

Required:
  --expect <profile>       Assertion profile: "cold-restore" or "survival"
                           cold-restore = today's behavior (daemon killed by the
                             installer sweep, app cold-restores scrollback, no
                             flashing). survival = Phase 1 target (daemon PID
                             unchanged, sessions still interactive).

Options:
  --allow-existing-install Proceed even if an Orca install already exists. The
                           run overwrites it with the --from/--to versions and
                           leaves the --to version installed (your prior build
                           is NOT restored). Without this flag the harness
                           refuses to run when an install exists, to protect a
                           developer's real Orca. Clean machines (CI/VM) never
                           need it.
  --keep-install           Skip teardown/uninstall (leaves the app installed)
  --asset-pattern <glob>   gh release asset glob (default: *windows-setup.exe)
  --soak-seconds <n>       Post-relaunch window watch duration (default: 180)
  -h, --help               Show this help
`

export function parseArgs(argv) {
  if (argv.includes('-h') || argv.includes('--help')) {
    return { help: true, usage: USAGE }
  }

  const opts = {
    from: takeValue(argv, '--from'),
    to: takeValue(argv, '--to'),
    fromRelease: takeValue(argv, '--from-release'),
    toRelease: takeValue(argv, '--to-release'),
    expect: takeValue(argv, '--expect'),
    assetPattern: takeValue(argv, '--asset-pattern') ?? '*windows-setup.exe',
    soakSeconds: Number(takeValue(argv, '--soak-seconds') ?? '180'),
    keepInstall: argv.includes('--keep-install'),
    allowExistingInstall: argv.includes('--allow-existing-install'),
    usage: USAGE
  }

  const errors = validate(opts)
  return { ...opts, errors }
}

function validate(opts) {
  const errors = []
  if (!opts.from && !opts.fromRelease) {
    errors.push('Missing base installer: pass --from <path> or --from-release <tag>')
  }
  if (opts.from && opts.fromRelease) {
    errors.push('Pass only one of --from / --from-release')
  }
  if (!opts.to && !opts.toRelease) {
    errors.push('Missing update installer: pass --to <path> or --to-release <tag>')
  }
  if (opts.to && opts.toRelease) {
    errors.push('Pass only one of --to / --to-release')
  }
  if (!opts.expect) {
    errors.push('Missing --expect <cold-restore|survival>')
  } else if (!VALID_PROFILES.has(opts.expect)) {
    errors.push(`Invalid --expect "${opts.expect}" (expected cold-restore or survival)`)
  }
  if (!Number.isFinite(opts.soakSeconds) || opts.soakSeconds < 0) {
    errors.push('--soak-seconds must be a non-negative number')
  }
  return errors
}

function takeValue(argv, flag) {
  const idx = argv.indexOf(flag)
  if (idx < 0) {
    return undefined
  }
  const value = argv[idx + 1]
  if (value === undefined || value.startsWith('--')) {
    return undefined
  }
  return value
}

/**
 * #8720 / #8758 — npm 12 allowScripts for relay native deps.
 *
 * npm 12 blocks lifecycle scripts not listed in package.json `allowScripts`
 * (warn + exit 0 when strict-allow-scripts is false). Linux has no node-pty
 * prebuild, so a missing allowlist leaves pty.node unbuilt while deploy still
 * "succeeds". `--ignore-scripts=false` alone does NOT override allowScripts.
 *
 * Regression:
 *   pnpm exec vitest run --config config/vitest.config.ts \
 *     src/main/ssh/ssh-relay-npm12-allow-scripts.test.ts
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const deploySource = readFileSync(join(__dirname, 'ssh-relay-deploy.ts'), 'utf8')
const installHarness = readFileSync(
  join(__dirname, 'ssh-relay-native-deps-install.test.ts'),
  'utf8'
)
const ptyHandlerSource = readFileSync(join(__dirname, '../../relay/pty-handler.ts'), 'utf8')

describe('#8720/#8758 npm 12 allowScripts for relay native deps', () => {
  it('writes versioned allowScripts for both native addons in package.json', () => {
    // Why: npm 12 requires each exact package@version in allowScripts; name-only
    // keys are accepted on some builds, but the deploy pins exact versions so the
    // allowlist must match RELAY_NATIVE_DEPS.
    expect(deploySource).toMatch(/'node-pty':\s*'1\.1\.0'/)
    expect(deploySource).toMatch(/'@parcel\/watcher':\s*'2\.5\.6'/)
    expect(deploySource).toMatch(/allowScripts:\s*RELAY_NATIVE_DEP_SCRIPT_ALLOWLIST/)
    expect(deploySource).toMatch(
      /Object\.entries\(RELAY_NATIVE_DEPS\)\.map\(\(\[name,\s*version\]\)\s*=>\s*\[`\$\{name\}@\$\{version\}`,\s*true\]\)/
    )
  })

  it('forces lifecycle scripts on install and rebuild (ignore-scripts hosts)', () => {
    // Complementary to allowScripts: NPM_CONFIG_IGNORE_SCRIPTS / npmrc ignore-scripts
    // still need the CLI override. allowScripts alone does not re-enable a host that
    // sets ignore-scripts=true, and ignore-scripts=false alone does not satisfy npm 12.
    expect(deploySource).toMatch(
      /npm install --ignore-scripts=false --omit=dev --no-audit --no-fund/
    )
    expect(deploySource).toMatch(/npm rebuild --ignore-scripts=false/)
  })

  it('probes with real require() so a present-but-unbuilt binding is not healthy', () => {
    // require.resolve only checks the JS entrypoint and passed when scripts were
    // blocked; the deploy probe must load the native binding.
    expect(deploySource).toMatch(/require\("node-pty"\)/)
    expect(deploySource).toMatch(/require\("@parcel\/watcher"\)/)
    expect(deploySource).not.toMatch(/require\.resolve\("node-pty"\)/)
  })

  it('install harness pins the allowScripts contract', () => {
    expect(installHarness).toContain("'node-pty@1.1.0': true")
    expect(installHarness).toContain("'@parcel/watcher@2.5.6': true")
    expect(installHarness).toContain('--ignore-scripts=false')
  })

  it('keeps the user-facing remote PTY error string for already-broken remotes', () => {
    // #8758 surface: if repair cannot build, spawn still explains the failure.
    expect(ptyHandlerSource).toContain('node-pty is not available on this remote host')
  })
})

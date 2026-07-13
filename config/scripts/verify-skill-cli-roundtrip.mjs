import { execFileSync } from 'node:child_process'
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { collectPackageFiles, packageDigest } from './generate-skill-bundle-manifest.mjs'

const cliVersion = process.argv.find((value) => value.startsWith('--cli='))?.slice('--cli='.length)
const autocrlf = process.argv
  .find((value) => value.startsWith('--autocrlf='))
  ?.slice('--autocrlf='.length)
const shape = process.argv.find((value) => value.startsWith('--shape='))?.slice('--shape='.length)
if (
  !cliVersion ||
  (autocrlf !== 'true' && autocrlf !== 'false') ||
  (shape !== 'symlink' && shape !== 'copy')
) {
  throw new Error(
    'Usage: verify-skill-cli-roundtrip.mjs --cli=<version> --autocrlf=true|false --shape=symlink|copy'
  )
}

const sandbox = await mkdtemp(join(tmpdir(), 'orca-skill-cli-roundtrip-'))
const home = join(sandbox, 'home')
const source = join(sandbox, 'source')
const manifest = JSON.parse(
  await readFile(resolve('resources/skills/current-manifest.json'), 'utf8')
)
const manifestByName = new Map(manifest.skills.map((skill) => [skill.name, skill]))
const fixtureName = 'orca-roundtrip-fixture'
const skillNames = [...manifest.skills.map((skill) => skill.name), fixtureName]

async function createRepresentativeFixture() {
  const fixtureRoot = join(source, 'skills', fixtureName)
  const executablePath = join(fixtureRoot, 'scripts', 'check.sh')
  await mkdir(join(fixtureRoot, 'assets'), { recursive: true })
  await mkdir(join(fixtureRoot, 'scripts'), { recursive: true })
  await writeFile(
    join(fixtureRoot, 'SKILL.md'),
    `---\nname: ${fixtureName}\ndescription: Exercises real multi-file CLI installation.\n---\n\n# Round-trip fixture\n`
  )
  await writeFile(join(fixtureRoot, 'assets', 'guide.txt'), 'nested text asset\nsecond line\n')
  await writeFile(join(fixtureRoot, 'assets', 'payload.bin'), Buffer.from([0, 1, 2, 13, 10, 255]))
  await writeFile(executablePath, '#!/bin/sh\nprintf fixture\\n\n')
  if (process.platform !== 'win32') {
    await chmod(executablePath, 0o755)
  }
  const files = await collectPackageFiles(fixtureRoot)
  manifestByName.set(fixtureName, { name: fixtureName, packageDigest: packageDigest(files) })
}

async function verifyPackage(name, packageRoot) {
  const expected = manifestByName.get(name)
  if (!expected) {
    throw new Error(`Missing current manifest entry for ${name}`)
  }
  const files = await collectPackageFiles(packageRoot)
  const digest = packageDigest(files)
  if (digest !== expected.packageDigest) {
    throw new Error(
      `${name} identity mismatch with core.autocrlf=${autocrlf}: ${digest} != ${expected.packageDigest}`
    )
  }
}

try {
  execFileSync(
    'git',
    [
      '-c',
      `core.autocrlf=${autocrlf}`,
      'clone',
      '--quiet',
      '--no-hardlinks',
      process.cwd(),
      source
    ],
    { stdio: 'inherit' }
  )
  // Why: shipped packages are currently single-file, so this temporary source
  // package keeps nested, binary, and POSIX executable semantics in the real CLI oracle.
  await createRepresentativeFixture()
  const cliArgs = [
    '--yes',
    `skills@${cliVersion}`,
    'add',
    source,
    '--skill',
    ...skillNames,
    '--agent',
    'codex',
    'claude-code',
    '--global',
    '--yes',
    ...(shape === 'copy' ? ['--copy'] : [])
  ]
  // Why: Node 24 rejects direct .cmd execution on Windows; cmd.exe is the
  // native launcher while POSIX keeps the argument-safe direct npx path.
  const cliExecutable = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'npx'
  execFileSync(
    cliExecutable,
    process.platform === 'win32' ? ['/d', '/s', '/c', 'npx.cmd', ...cliArgs] : cliArgs,
    {
      cwd: source,
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        XDG_STATE_HOME: join(home, '.state'),
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'core.autocrlf',
        GIT_CONFIG_VALUE_0: autocrlf
      },
      stdio: 'inherit'
    }
  )

  for (const name of skillNames) {
    const canonical = join(home, '.agents', 'skills', name)
    const canonicalStat = await lstat(canonical)
    if (!canonicalStat.isDirectory() || canonicalStat.isSymbolicLink()) {
      throw new Error(`${name} canonical CLI placement is not a real directory`)
    }
    await verifyPackage(name, canonical)

    const provider = join(home, '.claude', 'skills', name)
    const providerStat = await lstat(provider)
    if (shape === 'symlink' && !providerStat.isSymbolicLink()) {
      throw new Error(`${name} provider CLI placement is not a symlink or junction`)
    }
    if (shape === 'copy' && (!providerStat.isDirectory() || providerStat.isSymbolicLink())) {
      throw new Error(`${name} provider CLI placement is not a copy`)
    }
    await verifyPackage(name, await realpath(provider))
  }
} finally {
  await rm(sandbox, { recursive: true, force: true })
}

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { constants } from 'node:fs'
import { access, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const SCHEMA_VERSION = 1
const SCRIPT_DIR = import.meta.dirname
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..')
const SKILLS_ROOT = path.join(REPO_ROOT, 'skills')
const OUTPUT_ROOT = path.join(REPO_ROOT, 'resources', 'skills')
const CURRENT_MANIFEST_PATH = path.join(OUTPUT_ROOT, 'current-manifest.json')
const SNAPSHOT_REGISTRY_PATH = path.join(OUTPUT_ROOT, 'snapshot-registry.json')
const RELEASE_MAPPING_PATH = path.join(OUTPUT_ROOT, 'release-mapping.json')

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function gitObjectSha(kind, bytes) {
  return createHash('sha1').update(`${kind} ${bytes.length}\0`).update(bytes).digest()
}

function normalizeText(bytes) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  return Buffer.from(text.replace(/\r\n/g, '\n').replace(/\r/g, '\n'), 'utf8')
}

function classifyFile(bytes) {
  if (bytes.includes(0)) {
    return 'binary'
  }
  try {
    normalizeText(bytes)
    return 'text'
  } catch {
    return 'binary'
  }
}

function assertSafeRelativePath(relativePath) {
  if (
    path.isAbsolute(relativePath) ||
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`)
  ) {
    throw new Error(`Unsafe skill package path: ${relativePath}`)
  }
}

function describeFile(manifestPath, bytes, executable) {
  const classification = classifyFile(bytes)
  const exactSha256 = sha256(bytes)
  const textNormalizedSha256 = classification === 'text' ? sha256(normalizeText(bytes)) : null
  return {
    path: manifestPath,
    size: bytes.length,
    executable,
    classification,
    exactSha256,
    textNormalizedSha256,
    identitySha256: classification === 'text' && !executable ? textNormalizedSha256 : exactSha256,
    gitBlobSha: gitObjectSha('blob', bytes).toString('hex')
  }
}

function gitTreeSha(entries) {
  const root = { directories: new Map(), files: [] }
  for (const entry of entries) {
    const parts = entry.path.split('/')
    const filename = parts.pop()
    let directory = root
    for (const part of parts) {
      let child = directory.directories.get(part)
      if (!child) {
        child = { directories: new Map(), files: [] }
        directory.directories.set(part, child)
      }
      directory = child
    }
    directory.files.push({ filename, ...entry })
  }

  function hashDirectory(directory) {
    const children = [
      ...[...directory.directories].map(([name, child]) => ({
        mode: '40000',
        name,
        hash: hashDirectory(child)
      })),
      ...directory.files.map((file) => ({
        mode: file.executable ? '100755' : '100644',
        name: file.filename,
        hash: Buffer.from(file.gitBlobSha, 'hex')
      }))
    ].sort((left, right) => {
      const leftName = left.mode === '40000' ? `${left.name}/` : left.name
      const rightName = right.mode === '40000' ? `${right.name}/` : right.name
      return Buffer.from(leftName).compare(Buffer.from(rightName))
    })
    const body = Buffer.concat(
      children.map(({ mode, name, hash }) =>
        Buffer.concat([Buffer.from(`${mode} ${name}\0`, 'utf8'), hash])
      )
    )
    return gitObjectSha('tree', body)
  }

  return hashDirectory(root).toString('hex')
}

async function collectPackageFiles(packageRoot) {
  const files = []
  const caseFoldedPaths = new Map()

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name)
      const relativePath = path.relative(packageRoot, absolutePath)
      assertSafeRelativePath(relativePath)
      const manifestPath = relativePath.split(path.sep).join('/')
      const foldedPath = manifestPath.toLocaleLowerCase('en-US')
      const collision = caseFoldedPaths.get(foldedPath)
      if (collision && collision !== manifestPath) {
        throw new Error(`Case-colliding skill paths: ${collision} and ${manifestPath}`)
      }
      caseFoldedPaths.set(foldedPath, manifestPath)

      const fileStat = await lstat(absolutePath)
      if (fileStat.isSymbolicLink()) {
        throw new Error(`Symlink is not allowed in a shipped skill: ${manifestPath}`)
      }
      if (fileStat.isDirectory()) {
        await visit(absolutePath)
        continue
      }
      if (!fileStat.isFile()) {
        throw new Error(`Special file is not allowed in a shipped skill: ${manifestPath}`)
      }

      const bytes = await readFile(absolutePath)
      const executable = (fileStat.mode & 0o111) !== 0
      files.push(describeFile(manifestPath, bytes, executable))
    }
  }

  await visit(packageRoot)
  return files
}

function collectGitPackageFiles(ref, name) {
  const sourcePrefix = `skills/${name}/`
  const output = execFileSync('git', ['ls-tree', '-r', '-z', ref, '--', `skills/${name}`])
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
  const caseFoldedPaths = new Map()
  return output.map((line) => {
    const match = /^(\d+) (\w+) ([a-f0-9]+)\t(.+)$/.exec(line)
    if (!match) {
      throw new Error(`Unexpected git tree entry at ${ref}: ${line}`)
    }
    const [, mode, type, objectSha, sourcePath] = match
    if (type !== 'blob' || (mode !== '100644' && mode !== '100755')) {
      throw new Error(`Unsupported shipped skill entry at ${ref}: ${line}`)
    }
    const manifestPath = sourcePath.slice(sourcePrefix.length)
    assertSafeRelativePath(manifestPath)
    const foldedPath = manifestPath.toLocaleLowerCase('en-US')
    const collision = caseFoldedPaths.get(foldedPath)
    if (collision && collision !== manifestPath) {
      throw new Error(`Case-colliding skill paths at ${ref}: ${collision} and ${manifestPath}`)
    }
    caseFoldedPaths.set(foldedPath, manifestPath)
    const bytes = execFileSync('git', ['cat-file', 'blob', objectSha])
    return describeFile(manifestPath, bytes, mode === '100755')
  })
}

function releaseTags() {
  return execFileSync(
    'git',
    ['for-each-ref', '--sort=creatordate', '--format=%(refname:short)', 'refs/tags/v*'],
    { encoding: 'utf8' }
  )
    .split('\n')
    .filter((tag) => /^v\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.-]+)?$/.test(tag))
}

function skillsTreeShaAtRef(ref) {
  try {
    const output = execFileSync('git', ['ls-tree', ref, 'skills'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
    return output ? output.split(/\s+/)[2] : null
  } catch {
    return null
  }
}

function skillNamesAtRef(ref) {
  try {
    return execFileSync('git', ['ls-tree', '-d', '--name-only', `${ref}:skills`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    })
      .split('\n')
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right, 'en'))
  } catch {
    return []
  }
}

function bootstrapReleaseHistory() {
  const registry = { schemaVersion: SCHEMA_VERSION, skills: {} }
  const mapping = { schemaVersion: SCHEMA_VERSION, releases: [] }
  let previousSkillsTreeSha = null

  for (const tag of releaseTags()) {
    const skillsTreeSha = skillsTreeShaAtRef(tag)
    // Why: one mapping per shipped package set proves provenance without
    // repeating hundreds of app releases that shipped identical skill bytes.
    if (!skillsTreeSha || skillsTreeSha === previousSkillsTreeSha) {
      continue
    }
    previousSkillsTreeSha = skillsTreeSha
    const revisions = {}
    for (const name of skillNamesAtRef(tag)) {
      const filesWithGitHashes = collectGitPackageFiles(tag, name)
      if (!filesWithGitHashes.some((file) => file.path === 'SKILL.md')) {
        continue
      }
      const digest = packageDigest(filesWithGitHashes)
      const snapshots = registry.skills[name] ?? []
      const latest = snapshots.at(-1)
      if (!latest || latest.packageDigest !== digest) {
        const files = filesWithGitHashes.map(({ gitBlobSha: _gitBlobSha, ...file }) => file)
        snapshots.push({
          releaseRevision: (latest?.releaseRevision ?? 0) + 1,
          packageDigest: digest,
          gitTreeSha: gitTreeSha(filesWithGitHashes),
          files
        })
        registry.skills[name] = snapshots
      }
      revisions[name] = snapshots.at(-1).releaseRevision
    }
    if (Object.keys(revisions).length > 0) {
      mapping.releases.push({ appVersion: tag.slice(1), skills: revisions })
    }
  }
  return { registry, mapping }
}

function packageDigest(files) {
  const identity = files.map((file) => ({
    path: file.path,
    executable: file.executable,
    classification: file.classification,
    identitySha256: file.identitySha256
  }))
  return sha256(Buffer.from(JSON.stringify(identity), 'utf8'))
}

async function readJsonIfPresent(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'))
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return fallback
    }
    throw error
  }
}

function readJsonAtRef(ref, relativePath) {
  try {
    return JSON.parse(
      execFileSync('git', ['show', `${ref}:${relativePath}`], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      })
    )
  } catch {
    return null
  }
}

function gitRefExists(ref) {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
      stdio: 'ignore'
    })
    return true
  } catch {
    return false
  }
}

function assertReleaseMappingProvenance(
  artifacts,
  {
    allowUnreleasedAppVersion = null,
    refExists = gitRefExists,
    digestAtRef = (ref, name) => packageDigest(collectGitPackageFiles(ref, name))
  } = {}
) {
  for (const release of artifacts.releaseMapping.releases) {
    const releaseRef = `v${release.appVersion}`
    if (!refExists(releaseRef)) {
      if (release.appVersion === allowUnreleasedAppVersion) {
        continue
      }
      throw new Error(`Skill release mapping references missing tag ${releaseRef}`)
    }
    for (const [name, revision] of Object.entries(release.skills)) {
      const snapshot = (artifacts.snapshotRegistry.skills[name] ?? []).find(
        (entry) => entry.releaseRevision === revision
      )
      if (!snapshot) {
        throw new Error(`Skill release mapping references unknown ${name} revision ${revision}`)
      }
      if (digestAtRef(releaseRef, name) !== snapshot.packageDigest) {
        throw new Error(
          `Skill release mapping for ${releaseRef} does not match shipped ${name} revision ${revision}`
        )
      }
    }
  }
}

function assertBaseHistoryPreserved(baseRef, artifacts) {
  if (!baseRef) {
    return
  }
  const baseRegistry = readJsonAtRef(baseRef, 'resources/skills/snapshot-registry.json')
  const baseMapping = readJsonAtRef(baseRef, 'resources/skills/release-mapping.json')
  if (baseRegistry) {
    for (const [name, snapshots] of Object.entries(baseRegistry.skills ?? {})) {
      const current = artifacts.snapshotRegistry.skills[name] ?? []
      if (JSON.stringify(current.slice(0, snapshots.length)) !== JSON.stringify(snapshots)) {
        throw new Error(`Skill snapshot history for ${name} differs from immutable base ${baseRef}`)
      }
    }
  }
  if (
    baseMapping &&
    JSON.stringify(artifacts.releaseMapping.releases.slice(0, baseMapping.releases.length)) !==
      JSON.stringify(baseMapping.releases)
  ) {
    throw new Error(`Skill release mapping differs from immutable base ${baseRef}`)
  }
}

async function buildArtifacts({ appVersion, recordRelease, bootstrapHistory = false }) {
  const history = bootstrapHistory ? bootstrapReleaseHistory() : null
  const existingRegistry =
    history?.registry ??
    (await readJsonIfPresent(SNAPSHOT_REGISTRY_PATH, {
      schemaVersion: SCHEMA_VERSION,
      skills: {}
    }))
  if (existingRegistry.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`Unsupported skill snapshot registry schema: ${existingRegistry.schemaVersion}`)
  }

  const skillDirectories = (await readdir(SKILLS_ROOT, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, 'en'))
  const currentSkills = []
  const nextRegistry = structuredClone(existingRegistry)

  for (const name of skillDirectories) {
    const filesWithGitHashes = await collectPackageFiles(path.join(SKILLS_ROOT, name))
    if (!filesWithGitHashes.some((file) => file.path === 'SKILL.md')) {
      throw new Error(`Skill package ${name} has no top-level SKILL.md`)
    }
    const digest = packageDigest(filesWithGitHashes)
    const existingSnapshots = nextRegistry.skills[name] ?? []
    const latest = existingSnapshots.at(-1)
    let snapshot = latest
    if (!latest || latest.packageDigest !== digest) {
      const files = filesWithGitHashes.map(({ gitBlobSha: _gitBlobSha, ...file }) => file)
      snapshot = {
        releaseRevision: (latest?.releaseRevision ?? 0) + 1,
        packageDigest: digest,
        gitTreeSha: gitTreeSha(filesWithGitHashes),
        files
      }
      existingSnapshots.push(snapshot)
      nextRegistry.skills[name] = existingSnapshots
    }
    const currentFiles = filesWithGitHashes.map(({ gitBlobSha: _gitBlobSha, ...file }) => file)
    currentSkills.push({
      name,
      sourcePath: `skills/${name}`,
      appVersion,
      releaseRevision: snapshot.releaseRevision,
      packageDigest: digest,
      gitTreeSha: gitTreeSha(filesWithGitHashes),
      files: currentFiles
    })
  }

  const currentManifest = {
    schemaVersion: SCHEMA_VERSION,
    appVersion,
    skills: currentSkills
  }
  const existingMapping =
    history?.mapping ??
    (await readJsonIfPresent(RELEASE_MAPPING_PATH, {
      schemaVersion: SCHEMA_VERSION,
      releases: []
    }))
  if (existingMapping.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`Unsupported skill release mapping schema: ${existingMapping.schemaVersion}`)
  }
  const releaseMapping = structuredClone(existingMapping)
  if (recordRelease) {
    const revisions = Object.fromEntries(
      currentSkills.map((skill) => [skill.name, skill.releaseRevision])
    )
    const prior = releaseMapping.releases.find((release) => release.appVersion === appVersion)
    if (prior && JSON.stringify(prior.skills) !== JSON.stringify(revisions)) {
      throw new Error(`Release mapping for ${appVersion} is immutable`)
    }
    if (!prior) {
      releaseMapping.releases.push({ appVersion, skills: revisions })
    }
  }

  return { currentManifest, snapshotRegistry: nextRegistry, releaseMapping }
}

function serialized(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

async function writeArtifacts(artifacts) {
  await mkdir(OUTPUT_ROOT, { recursive: true })
  await Promise.all([
    writeFile(CURRENT_MANIFEST_PATH, serialized(artifacts.currentManifest)),
    writeFile(SNAPSHOT_REGISTRY_PATH, serialized(artifacts.snapshotRegistry)),
    writeFile(RELEASE_MAPPING_PATH, serialized(artifacts.releaseMapping))
  ])
}

async function verifyArtifacts(artifacts) {
  const expected = [
    [CURRENT_MANIFEST_PATH, artifacts.currentManifest],
    [SNAPSHOT_REGISTRY_PATH, artifacts.snapshotRegistry],
    [RELEASE_MAPPING_PATH, artifacts.releaseMapping]
  ]
  const stale = []
  for (const [filePath, value] of expected) {
    try {
      await access(filePath, constants.R_OK)
      if ((await readFile(filePath, 'utf8')) !== serialized(value)) {
        stale.push(filePath)
      }
    } catch {
      stale.push(filePath)
    }
  }
  if (stale.length > 0) {
    throw new Error(
      `Generated skill artifacts are stale:\n${stale.map((filePath) => path.relative(REPO_ROOT, filePath)).join('\n')}\nRun pnpm generate:skill-bundle-manifest.`
    )
  }
}

async function main() {
  const packageJson = JSON.parse(await readFile(path.join(REPO_ROOT, 'package.json'), 'utf8'))
  const write = process.argv.includes('--write')
  const recordRelease = process.argv.includes('--record-release')
  const bootstrapHistory = process.argv.includes('--bootstrap-release-history')
  const baseRef = process.argv
    .find((arg) => arg.startsWith('--base-ref='))
    ?.slice('--base-ref='.length)
  const artifacts = await buildArtifacts({
    appVersion: packageJson.version,
    recordRelease,
    bootstrapHistory
  })
  // Why: a package version can remain unchanged while main advances; only
  // tag bytes prove that a historical revision actually shipped.
  assertReleaseMappingProvenance(artifacts, {
    allowUnreleasedAppVersion: recordRelease ? packageJson.version : null
  })
  assertBaseHistoryPreserved(baseRef, artifacts)
  await (write ? writeArtifacts : verifyArtifacts)(artifacts)
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}

export {
  assertReleaseMappingProvenance,
  buildArtifacts,
  classifyFile,
  collectPackageFiles,
  gitTreeSha,
  normalizeText,
  packageDigest
}

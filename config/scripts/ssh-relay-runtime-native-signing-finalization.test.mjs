import { createHash } from 'node:crypto'
import { appendFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { expectedSshRelayRuntimeClosureEntries } from './ssh-relay-runtime-closure.mjs'
import { sshRelayRuntimeCompatibility } from './ssh-relay-runtime-compatibility.mjs'
import { computeSshRelayRuntimeContentId } from './ssh-relay-runtime-identity.mjs'
import { finalizeSshRelayRuntimeNativeSigning } from './ssh-relay-runtime-native-signing-finalization.mjs'
import { prepareSshRelayRuntimeNativeSigningStage } from './ssh-relay-runtime-native-signing-stage.mjs'

const temporaryDirectories = []
const SOURCE_DATE_EPOCH = 1_788_739_200
const GIT_COMMIT = '1'.repeat(40)

function digest(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

function toolchain() {
  return Object.fromEntries(
    [
      'buildNode',
      'bundledNode',
      'compiler',
      'buildSystem',
      'python',
      'archive',
      'nodeAddonApi',
      'nodeGyp',
      'strip'
    ].map((name, index) => [
      name,
      { version: `${name} fixture`, sha256: `sha256:${(index + 1).toString(16).repeat(64)}` }
    ])
  )
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ssh-relay-signing-finalization-'))
  temporaryDirectories.push(root)
  const sourceRuntimeRoot = join(root, 'source-runtime')
  await mkdir(sourceRuntimeRoot)
  const entries = []
  for (const entry of expectedSshRelayRuntimeClosureEntries('darwin-arm64')) {
    const path = join(sourceRuntimeRoot, ...entry.path.split('/'))
    if (entry.type === 'directory') {
      await mkdir(path, { recursive: true, mode: entry.mode })
      entries.push(entry)
      continue
    }
    const bytes = Buffer.from(`native finalization fixture:${entry.path}`)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, bytes, { mode: entry.mode })
    entries.push({ ...entry, size: bytes.length, sha256: digest(bytes) })
  }
  const base = {
    identitySchemaVersion: 1,
    tupleId: 'darwin-arm64',
    os: 'darwin',
    architecture: 'arm64',
    compatibility: sshRelayRuntimeCompatibility['darwin-arm64'],
    nodeVersion: '24.18.0',
    dependencies: { nodePtyVersion: '1.1.0', parcelWatcherVersion: '2.5.6' },
    entries
  }
  const files = entries.filter((entry) => entry.type === 'file')
  const sourceIdentity = {
    ...base,
    contentId: computeSshRelayRuntimeContentId(base),
    fileCount: files.length,
    expandedSize: files.reduce((total, entry) => total + entry.size, 0)
  }
  const returnedRoot = join(root, 'returned')
  const report = await prepareSshRelayRuntimeNativeSigningStage({
    identity: sourceIdentity,
    runtimeRoot: sourceRuntimeRoot,
    stagingRoot: returnedRoot,
    platform: 'darwin'
  })
  for (const entry of report.signingFiles) {
    await appendFile(join(returnedRoot, ...entry.path.split('/')), ':signed')
  }
  const nodeRelease = JSON.parse(
    await readFile(new URL('../ssh-relay-node-release-v24.18.0.json', import.meta.url), 'utf8')
  )
  const selection = {
    tupleId: report.tupleId,
    platform: report.platform,
    policy: report.policy,
    immutableVendorFiles: report.immutableVendorFiles,
    signingFiles: report.signingFiles,
    preservedUpstreamFiles: report.preservedUpstreamFiles,
    verificationFiles: [...report.immutableVendorFiles, ...report.signingFiles].map(
      ({ path, role, sourceSha256, sourceSize }) => ({ path, role, sourceSha256, sourceSize })
    )
  }
  return { root, sourceRuntimeRoot, returnedRoot, sourceIdentity, selection, nodeRelease }
}

function nativeReport(sourceIdentity, finalIdentity, selection) {
  const finalFiles = new Map(
    finalIdentity.entries
      .filter((entry) => entry.type === 'file')
      .map((entry) => [entry.path, entry])
  )
  return {
    tupleId: finalIdentity.tupleId,
    sourceContentId: sourceIdentity.contentId,
    finalContentId: finalIdentity.contentId,
    verifiedFiles: selection.verificationFiles.map((entry) => ({
      path: entry.path,
      role: entry.role,
      sha256: finalFiles.get(entry.path).sha256,
      signerKind: entry.role === 'node' ? 'official-node' : 'orca-built',
      authority: `Developer ID Application: Fixture (${entry.role === 'node' ? 'HX7739G8FX' : 'ABCDEFGHIJ'})`,
      teamIdentifier: entry.role === 'node' ? 'HX7739G8FX' : 'ABCDEFGHIJ'
    }))
  }
}

function finalizationInput(value, outputDirectory) {
  return {
    ...value,
    outputDirectory,
    expectedOrcaTeamIdentifier: 'ABCDEFGHIJ',
    sourceDateEpoch: SOURCE_DATE_EPOCH,
    gitCommit: GIT_COMMIT,
    builder: 'https://github.com/stablyai/orca/ssh-relay-runtime-native-signing-fixture',
    runner: {
      os: 'macOS',
      architecture: 'ARM64',
      environment: 'fixture',
      requestedLabel: 'macos-15',
      image: { os: 'macos', version: 'fixture' }
    },
    toolchain: toolchain(),
    nativeVerificationTool: { name: 'codesign', version: 'fixture-v1' },
    verifiedAt: '2026-07-15T12:00:00.000Z',
    verifyNativeImpl: ({ sourceIdentity, finalIdentity, selection }) =>
      nativeReport(sourceIdentity, finalIdentity, selection),
    smokeImpl: async () => ({
      tree: { verified: true },
      smoke: { nodeVersion: 'v24.18.0', pty: 'passed', watcher: 'passed' }
    })
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('SSH relay runtime native signing finalization', () => {
  it('emits only final signed-byte assets after native verification and smoke', async () => {
    const value = await fixture()
    const outputDirectory = join(value.root, 'final')
    const result = await finalizeSshRelayRuntimeNativeSigning(
      finalizationInput(value, outputDirectory)
    )

    expect(result.finalContentId).not.toBe(value.sourceIdentity.contentId)
    expect(result.returnedFiles).toHaveLength(3)
    expect(await readdir(result.assetsRoot)).toHaveLength(4)
    expect(
      (await readdir(result.assetsRoot)).some((name) => name.endsWith('.manifest-tuple.json'))
    ).toBe(true)
    expect(await readdir(result.evidenceRoot)).toEqual(
      expect.arrayContaining([
        'darwin-arm64.final-identity.json',
        'darwin-arm64.finalization.json',
        'darwin-arm64.native-verification.json'
      ])
    )
  })

  it('removes the complete output when native trust fails', async () => {
    const value = await fixture()
    const outputDirectory = join(value.root, 'rejected')
    const input = finalizationInput(value, outputDirectory)
    input.verifyNativeImpl = async () => {
      throw new Error('fixture native trust denied')
    }
    await expect(finalizeSshRelayRuntimeNativeSigning(input)).rejects.toThrow(/trust denied/i)
    await expect(readdir(outputDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

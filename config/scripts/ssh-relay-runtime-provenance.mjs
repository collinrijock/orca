import { createHash } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const require = createRequire(import.meta.url)

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

function spdxId(value) {
  return `SPDXRef-${value.replace(/[^A-Za-z0-9.-]/g, '-')}`
}

function packageRecord(name, version, license) {
  return {
    name,
    SPDXID: spdxId(`Package-${name}`),
    versionInfo: version,
    downloadLocation: 'NOASSERTION',
    filesAnalyzed: false,
    licenseConcluded: license,
    licenseDeclared: license,
    copyrightText: 'NOASSERTION'
  }
}

function installedPackage(name) {
  const parsed = require(`${name}/package.json`)
  return packageRecord(parsed.name, parsed.version, parsed.license ?? 'NOASSERTION')
}

function watcherNativePackage(tuple) {
  if (tuple.startsWith('linux-')) {
    return `@parcel/watcher-linux-${tuple.slice('linux-'.length)}`
  }
  return `@parcel/watcher-${tuple}`
}

async function writeJson(path, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await writeFile(path, bytes, { flag: 'wx', mode: 0o600 })
  return { name: path.split(/[\\/]/).at(-1), size: bytes.length, sha256: sha256(bytes) }
}

export async function writeSshRelayRuntimeMetadata({
  outputDirectory,
  identity,
  archive,
  nodeRelease,
  sourceDateEpoch,
  gitCommit,
  builder,
  toolchain
}) {
  const createdAt = new Date(sourceDateEpoch * 1000).toISOString()
  const sbomName = `orca-ssh-relay-runtime-${identity.tupleId}.spdx.json`
  const provenanceName = `orca-ssh-relay-runtime-${identity.tupleId}.provenance.json`
  const identityName = `orca-ssh-relay-runtime-${identity.tupleId}.identity.json`
  const files = identity.entries
    .filter((entry) => entry.type === 'file')
    .map((entry, index) => ({
      fileName: entry.path,
      SPDXID: `SPDXRef-File-${index + 1}`,
      checksums: [{ algorithm: 'SHA256', checksumValue: entry.sha256.slice('sha256:'.length) }],
      licenseConcluded: 'NOASSERTION',
      copyrightText: 'NOASSERTION'
    }))
  const packages = [
    packageRecord('node', identity.nodeVersion, 'NOASSERTION'),
    packageRecord('orca-ssh-relay', '0.1.0', 'NOASSERTION'),
    installedPackage('node-pty'),
    installedPackage('@parcel/watcher'),
    installedPackage(watcherNativePackage(identity.tupleId)),
    installedPackage('detect-libc'),
    installedPackage('is-glob'),
    installedPackage('is-extglob'),
    installedPackage('picomatch')
  ]
  const documentId = identity.contentId.slice('sha256:'.length)
  const sbom = {
    spdxVersion: 'SPDX-2.3',
    dataLicense: 'CC0-1.0',
    SPDXID: 'SPDXRef-DOCUMENT',
    name: `Orca SSH relay runtime ${identity.tupleId}`,
    documentNamespace: `https://github.com/stablyai/orca/ssh-relay-runtime/${documentId}`,
    creationInfo: { created: createdAt, creators: ['Organization: Stably AI'] },
    packages,
    files,
    relationships: packages.map((component) => ({
      spdxElementId: 'SPDXRef-DOCUMENT',
      relationshipType: 'DESCRIBES',
      relatedSpdxElement: component.SPDXID
    }))
  }
  const nativeFiles = identity.entries
    .filter(
      (entry) =>
        entry.type === 'file' &&
        ['node', 'node-pty-native', 'parcel-watcher-native', 'native-runtime'].includes(entry.role)
    )
    .map((entry) => ({ path: entry.path, sha256: entry.sha256 }))
  const provenance = {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [{ name: archive.name, digest: { sha256: archive.sha256.slice('sha256:'.length) } }],
    predicateType: 'https://slsa.dev/provenance/v1',
    predicate: {
      buildDefinition: {
        buildType: 'https://github.com/stablyai/orca/ssh-relay-runtime-build/v1',
        externalParameters: {
          tuple: identity.tupleId,
          nodeVersion: identity.nodeVersion,
          sourceDateEpoch
        },
        internalParameters: { toolchain },
        resolvedDependencies: [
          {
            uri: nodeRelease.baseUrl,
            digest: { sha256: nodeRelease.archives[identity.tupleId].sha256 }
          },
          {
            uri: nodeRelease.signature.key.sourceUrl,
            digest: { sha256: nodeRelease.signature.key.sha256 }
          },
          { uri: `git+https://github.com/stablyai/orca@${gitCommit}`, digest: { gitCommit } }
        ]
      },
      runDetails: {
        builder: { id: builder },
        metadata: { invocationId: process.env.GITHUB_RUN_ID ?? 'local-unpublished-build' },
        byproducts: [{ name: 'native-files', content: nativeFiles }]
      }
    }
  }
  const identityDocument = {
    ...identity,
    archive: {
      name: archive.name,
      size: archive.size,
      expandedSize: identity.expandedSize,
      fileCount: identity.fileCount,
      sha256: archive.sha256
    }
  }
  const [sbomAsset, provenanceAsset, identityAsset] = await Promise.all([
    writeJson(join(outputDirectory, sbomName), sbom),
    writeJson(join(outputDirectory, provenanceName), provenance),
    writeJson(join(outputDirectory, identityName), identityDocument)
  ])
  for (const asset of [sbomAsset, provenanceAsset, identityAsset]) {
    const metadata = await stat(join(outputDirectory, asset.name))
    const bytes = await readFile(join(outputDirectory, asset.name))
    if (metadata.size !== asset.size || sha256(bytes) !== asset.sha256) {
      throw new Error(`Runtime metadata changed while being finalized: ${asset.name}`)
    }
  }
  return { sbom: sbomAsset, provenance: provenanceAsset, identity: identityAsset }
}

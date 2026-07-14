import type { SshRelayArtifactManifest } from './ssh-relay-artifact-schema'
import {
  computeSshRelayRuntimeContentId,
  type SshRelayRuntimeIdentityInput
} from './ssh-relay-runtime-identity'
import { sshRelayRuntimeArchiveName } from './ssh-relay-release-asset'

const digest = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`

export function createSshRelayArtifactTestManifest(): SshRelayArtifactManifest {
  const runtime: SshRelayRuntimeIdentityInput = {
    tupleId: 'linux-x64-glibc',
    os: 'linux',
    architecture: 'x64',
    compatibility: {
      kind: 'linux',
      minimumKernelVersion: '4.18',
      libc: {
        family: 'glibc',
        minimumVersion: '2.28',
        minimumLibstdcxxVersion: '6.0.25',
        minimumGlibcxxVersion: '3.4.25'
      }
    },
    nodeVersion: '24.18.0',
    dependencies: {
      nodePtyVersion: '1.1.0',
      parcelWatcherVersion: '2.5.6'
    },
    entries: [
      { path: 'bin', type: 'directory', mode: 0o755 },
      {
        path: 'bin/node',
        type: 'file',
        role: 'node',
        size: 40,
        mode: 0o755,
        sha256: digest('1')
      },
      {
        path: 'relay.js',
        type: 'file',
        role: 'relay',
        size: 20,
        mode: 0o644,
        sha256: digest('2')
      },
      {
        path: 'relay-watcher.js',
        type: 'file',
        role: 'relay-watcher',
        size: 15,
        mode: 0o644,
        sha256: digest('3')
      },
      { path: 'node_modules', type: 'directory', mode: 0o755 },
      { path: 'node_modules/node-pty', type: 'directory', mode: 0o755 },
      {
        path: 'node_modules/node-pty/package.json',
        type: 'file',
        role: 'runtime-javascript',
        size: 10,
        mode: 0o644,
        sha256: digest('4')
      },
      { path: 'node_modules/node-pty/build', type: 'directory', mode: 0o755 },
      { path: 'node_modules/node-pty/build/Release', type: 'directory', mode: 0o755 },
      {
        path: 'node_modules/node-pty/build/Release/pty.node',
        type: 'file',
        role: 'node-pty-native',
        size: 30,
        mode: 0o755,
        sha256: digest('5')
      },
      { path: 'node_modules/@parcel', type: 'directory', mode: 0o755 },
      { path: 'node_modules/@parcel/watcher', type: 'directory', mode: 0o755 },
      {
        path: 'node_modules/@parcel/watcher/package.json',
        type: 'file',
        role: 'runtime-javascript',
        size: 10,
        mode: 0o644,
        sha256: digest('6')
      },
      {
        path: 'node_modules/@parcel/watcher-linux-x64-glibc',
        type: 'directory',
        mode: 0o755
      },
      {
        path: 'node_modules/@parcel/watcher-linux-x64-glibc/watcher.node',
        type: 'file',
        role: 'parcel-watcher-native',
        size: 25,
        mode: 0o755,
        sha256: digest('7')
      },
      {
        path: 'THIRD_PARTY_LICENSES.txt',
        type: 'file',
        role: 'license',
        size: 10,
        mode: 0o644,
        sha256: digest('8')
      }
    ]
  }
  const contentId = computeSshRelayRuntimeContentId(runtime)
  const fileEntries = runtime.entries.filter((entry) => entry.type === 'file')
  const expandedSize = fileEntries.reduce((total, entry) => total + entry.size, 0)

  return {
    schemaVersion: 1,
    build: {
      tag: 'v1.4.140-rc.1',
      channel: 'rc',
      version: '1.4.140-rc.1',
      relayProtocolVersion: 1
    },
    createdAt: '2026-07-14T00:00:00.000Z',
    tuples: [
      {
        ...runtime,
        contentId,
        archive: {
          name: sshRelayRuntimeArchiveName(runtime.tupleId, contentId),
          size: 100,
          expandedSize,
          fileCount: fileEntries.length,
          sha256: digest('a')
        },
        metadataAssets: {
          sbom: {
            name: 'orca-ssh-relay-runtime-linux-x64-glibc.spdx.json',
            size: 50,
            sha256: digest('b')
          },
          provenance: {
            name: 'orca-ssh-relay-runtime-linux-x64-glibc.provenance.json',
            size: 50,
            sha256: digest('c')
          }
        },
        nativeVerification: {
          policy: 'linux-hash-only-v1',
          tool: { name: 'sha256sum', version: '9.4' },
          verifiedAt: '2026-07-14T00:00:00.000Z',
          files: [
            { path: 'bin/node', sha256: digest('1') },
            { path: 'node_modules/node-pty/build/Release/pty.node', sha256: digest('5') },
            {
              path: 'node_modules/@parcel/watcher-linux-x64-glibc/watcher.node',
              sha256: digest('7')
            }
          ]
        }
      }
    ],
    signatures: [
      {
        algorithm: 'ed25519-v1',
        keyId: digest('d'),
        signature: Buffer.alloc(64).toString('base64')
      }
    ]
  }
}

import { createHash } from 'node:crypto'

export type SshRelayDigest = `sha256:${string}`
export type SshRelayRuntimeTupleId =
  | 'linux-x64-glibc'
  | 'linux-arm64-glibc'
  | 'linux-x64-musl'
  | 'linux-arm64-musl'
  | 'darwin-x64'
  | 'darwin-arm64'
  | 'win32-x64'
  | 'win32-arm64'

export type SshRelayRuntimeFileRole =
  | 'node'
  | 'relay'
  | 'relay-watcher'
  | 'node-pty-native'
  | 'parcel-watcher-native'
  | 'native-runtime'
  | 'runtime-javascript'
  | 'license'

export type SshRelayRuntimeEntry =
  | { path: string; type: 'directory'; mode: 0o755 }
  | {
      path: string
      type: 'file'
      role: SshRelayRuntimeFileRole
      size: number
      mode: 0o644 | 0o755
      sha256: SshRelayDigest
    }

export type SshRelayLinuxCompatibility = {
  kind: 'linux'
  minimumKernelVersion: string
  libc:
    | {
        family: 'glibc'
        minimumVersion: string
        minimumLibstdcxxVersion: string
        minimumGlibcxxVersion: string
      }
    | {
        family: 'musl'
        minimumVersion: string
        minimumLibstdcxxVersion: null
        minimumGlibcxxVersion: null
      }
}

export type SshRelayRuntimeCompatibility =
  | SshRelayLinuxCompatibility
  | { kind: 'darwin'; minimumVersion: string }
  | {
      kind: 'windows'
      minimumBuild: number
      minimumOpenSshVersion: string
      minimumPowerShellVersion: string
      minimumDotNetFrameworkRelease: number
    }

export type SshRelayRuntimeIdentityInput = {
  tupleId: SshRelayRuntimeTupleId
  os: 'linux' | 'darwin' | 'win32'
  architecture: 'x64' | 'arm64'
  compatibility: SshRelayRuntimeCompatibility
  nodeVersion: string
  dependencies: {
    nodePtyVersion: string
    parcelWatcherVersion: string
  }
  entries: SshRelayRuntimeEntry[]
}

function canonicalCompatibility(compatibility: SshRelayRuntimeCompatibility): object {
  if (compatibility.kind === 'linux') {
    return {
      kind: compatibility.kind,
      minimumKernelVersion: compatibility.minimumKernelVersion,
      libc: {
        family: compatibility.libc.family,
        minimumVersion: compatibility.libc.minimumVersion,
        minimumLibstdcxxVersion: compatibility.libc.minimumLibstdcxxVersion,
        minimumGlibcxxVersion: compatibility.libc.minimumGlibcxxVersion
      }
    }
  }
  if (compatibility.kind === 'darwin') {
    return { kind: compatibility.kind, minimumVersion: compatibility.minimumVersion }
  }
  return {
    kind: compatibility.kind,
    minimumBuild: compatibility.minimumBuild,
    minimumOpenSshVersion: compatibility.minimumOpenSshVersion,
    minimumPowerShellVersion: compatibility.minimumPowerShellVersion,
    minimumDotNetFrameworkRelease: compatibility.minimumDotNetFrameworkRelease
  }
}

export function canonicalSshRelayRuntimeIdentityBytes(
  runtime: SshRelayRuntimeIdentityInput
): Buffer {
  const entries = [...runtime.entries]
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
    .map((entry) =>
      entry.type === 'directory'
        ? { path: entry.path, type: entry.type, mode: entry.mode }
        : {
            path: entry.path,
            type: entry.type,
            role: entry.role,
            size: entry.size,
            mode: entry.mode,
            sha256: entry.sha256
          }
    )

  // Why: runtime identity excludes archive packing, timestamps, SBOM, and signing metadata so the
  // same executable tree has one stable content address across reproducible release rebuilds.
  const projection = {
    identitySchemaVersion: 1,
    tupleId: runtime.tupleId,
    os: runtime.os,
    architecture: runtime.architecture,
    compatibility: canonicalCompatibility(runtime.compatibility),
    nodeVersion: runtime.nodeVersion,
    dependencies: {
      nodePtyVersion: runtime.dependencies.nodePtyVersion,
      parcelWatcherVersion: runtime.dependencies.parcelWatcherVersion
    },
    entries
  }
  return Buffer.from(JSON.stringify(projection), 'utf8')
}

export function computeSshRelayRuntimeContentId(
  runtime: SshRelayRuntimeIdentityInput
): SshRelayDigest {
  const hex = createHash('sha256')
    .update(canonicalSshRelayRuntimeIdentityBytes(runtime))
    .digest('hex')
  return `sha256:${hex}`
}

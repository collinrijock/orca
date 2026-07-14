import { z } from 'zod'

import { assertSshRelayRuntimeTupleConsistency } from './ssh-relay-artifact-consistency'
import { parseSshRelayReleaseTag } from './ssh-relay-release-asset'
import type { SshRelayDigest, SshRelayRuntimeIdentityInput } from './ssh-relay-runtime-identity'

const MAX_ARCHIVE_SIZE = 100 * 1024 * 1024
const MAX_EXPANDED_SIZE = 350 * 1024 * 1024
const MAX_FILE_SIZE = 250 * 1024 * 1024
const MAX_ENTRIES = 5_000
const VERSION = /^\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?$/
const NUMERIC_VERSION = /^\d+\.\d+(?:\.\d+)?$/
const OPENSSH_VERSION = /^\d+\.\d+p\d+$/
const ASSET_NAME = /^[A-Za-z0-9._-]+$/
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

const digestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/)
const safeSizeSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const versionSchema = z.string().regex(VERSION).max(64)
const numericVersionSchema = z.string().regex(NUMERIC_VERSION).max(64)
const timestampSchema = z
  .string()
  .regex(TIMESTAMP)
  .refine(
    (value) => {
      const milliseconds = Date.parse(value)
      return !Number.isNaN(milliseconds) && new Date(milliseconds).toISOString() === value
    },
    { message: 'invalid UTC timestamp' }
  )

const directoryEntrySchema = z
  .object({ path: z.string(), type: z.literal('directory'), mode: z.literal(0o755) })
  .strict()
const fileEntrySchema = z
  .object({
    path: z.string(),
    type: z.literal('file'),
    role: z.enum([
      'node',
      'relay',
      'relay-watcher',
      'node-pty-native',
      'parcel-watcher-native',
      'native-runtime',
      'runtime-javascript',
      'license'
    ]),
    size: safeSizeSchema.max(MAX_FILE_SIZE),
    mode: z.union([z.literal(0o644), z.literal(0o755)]),
    sha256: digestSchema
  })
  .strict()
const entrySchema = z.discriminatedUnion('type', [directoryEntrySchema, fileEntrySchema])

const glibcSchema = z
  .object({
    family: z.literal('glibc'),
    minimumVersion: numericVersionSchema,
    minimumLibstdcxxVersion: numericVersionSchema,
    minimumGlibcxxVersion: numericVersionSchema
  })
  .strict()
const muslSchema = z
  .object({
    family: z.literal('musl'),
    minimumVersion: numericVersionSchema,
    minimumLibstdcxxVersion: z.null(),
    minimumGlibcxxVersion: z.null()
  })
  .strict()
const compatibilitySchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('linux'),
      minimumKernelVersion: numericVersionSchema,
      libc: z.discriminatedUnion('family', [glibcSchema, muslSchema])
    })
    .strict(),
  z.object({ kind: z.literal('darwin'), minimumVersion: numericVersionSchema }).strict(),
  z
    .object({
      kind: z.literal('windows'),
      minimumBuild: safeSizeSchema,
      minimumOpenSshVersion: z.string().regex(OPENSSH_VERSION).max(64),
      minimumPowerShellVersion: numericVersionSchema,
      minimumDotNetFrameworkRelease: safeSizeSchema
    })
    .strict()
])

const metadataAssetSchema = z
  .object({ name: z.string().regex(ASSET_NAME), size: safeSizeSchema, sha256: digestSchema })
  .strict()
const nativeVerificationSchema = z
  .object({
    policy: z.enum(['linux-hash-only-v1', 'apple-developer-id-v1', 'signpath-authenticode-v1']),
    tool: z
      .object({ name: z.string().regex(ASSET_NAME), version: z.string().min(1).max(64) })
      .strict(),
    verifiedAt: timestampSchema,
    files: z
      .array(z.object({ path: z.string(), sha256: digestSchema }).strict())
      .min(1)
      .max(MAX_ENTRIES)
  })
  .strict()

const tupleSchema = z
  .object({
    tupleId: z.enum([
      'linux-x64-glibc',
      'linux-arm64-glibc',
      'linux-x64-musl',
      'linux-arm64-musl',
      'darwin-x64',
      'darwin-arm64',
      'win32-x64',
      'win32-arm64'
    ]),
    os: z.enum(['linux', 'darwin', 'win32']),
    architecture: z.enum(['x64', 'arm64']),
    compatibility: compatibilitySchema,
    nodeVersion: versionSchema,
    dependencies: z
      .object({ nodePtyVersion: versionSchema, parcelWatcherVersion: versionSchema })
      .strict(),
    entries: z.array(entrySchema).min(1).max(MAX_ENTRIES),
    contentId: digestSchema,
    archive: z
      .object({
        name: z.string().regex(ASSET_NAME),
        size: safeSizeSchema.max(MAX_ARCHIVE_SIZE),
        expandedSize: safeSizeSchema.max(MAX_EXPANDED_SIZE),
        fileCount: safeSizeSchema.max(MAX_ENTRIES),
        sha256: digestSchema
      })
      .strict(),
    metadataAssets: z
      .object({ sbom: metadataAssetSchema, provenance: metadataAssetSchema })
      .strict(),
    nativeVerification: nativeVerificationSchema
  })
  .strict()

const signatureSchema = z
  .object({
    algorithm: z.literal('ed25519-v1'),
    keyId: digestSchema,
    signature: z
      .string()
      .regex(/^[A-Za-z0-9+/]+={0,2}$/)
      .refine(
        (value) => {
          const decoded = Buffer.from(value, 'base64')
          return decoded.length === 64 && decoded.toString('base64') === value
        },
        { message: 'Ed25519 signature must be canonical base64 encoding of 64 bytes' }
      )
  })
  .strict()

const unsignedManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    build: z
      .object({
        tag: z.string(),
        channel: z.enum(['stable', 'rc', 'perf']),
        version: z.string(),
        relayProtocolVersion: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
      })
      .strict(),
    createdAt: timestampSchema,
    tuples: z.array(tupleSchema).min(1).max(8)
  })
  .strict()
const manifestSchema = unsignedManifestSchema
  .extend({ signatures: z.array(signatureSchema).min(1).max(4) })
  .strict()

export type SshRelayManifestSignature = {
  algorithm: 'ed25519-v1'
  keyId: SshRelayDigest
  signature: string
}
export type SshRelayRuntimeTuple = SshRelayRuntimeIdentityInput & {
  contentId: SshRelayDigest
  archive: {
    name: string
    size: number
    expandedSize: number
    fileCount: number
    sha256: SshRelayDigest
  }
  metadataAssets: {
    sbom: { name: string; size: number; sha256: SshRelayDigest }
    provenance: { name: string; size: number; sha256: SshRelayDigest }
  }
  nativeVerification: {
    policy: 'linux-hash-only-v1' | 'apple-developer-id-v1' | 'signpath-authenticode-v1'
    tool: { name: string; version: string }
    verifiedAt: string
    files: { path: string; sha256: SshRelayDigest }[]
  }
}
export type SshRelayUnsignedArtifactManifest = {
  schemaVersion: 1
  build: {
    tag: string
    channel: 'stable' | 'rc' | 'perf'
    version: string
    relayProtocolVersion: number
  }
  createdAt: string
  tuples: SshRelayRuntimeTuple[]
}
export type SshRelayArtifactManifest = SshRelayUnsignedArtifactManifest & {
  signatures: SshRelayManifestSignature[]
}

function validateUnsignedManifest(
  parsed: SshRelayUnsignedArtifactManifest
): SshRelayUnsignedArtifactManifest {
  const release = parseSshRelayReleaseTag(parsed.build.tag)
  if (release.channel !== parsed.build.channel || release.version !== parsed.build.version) {
    throw new Error('SSH relay manifest build identity does not match its exact release tag')
  }
  const tupleIds = new Set<string>()
  for (const tuple of parsed.tuples) {
    if (tupleIds.has(tuple.tupleId)) {
      throw new Error(`SSH relay manifest has duplicate tuple: ${tuple.tupleId}`)
    }
    tupleIds.add(tuple.tupleId)
    assertSshRelayRuntimeTupleConsistency(tuple)
  }
  return parsed
}

function withoutSignatures(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return input
  }
  const { signatures: _signatures, ...unsigned } = input as Record<string, unknown>
  return unsigned
}

export function parseSshRelayUnsignedArtifactManifest(
  input: unknown
): SshRelayUnsignedArtifactManifest {
  const parsed = unsignedManifestSchema.parse(
    withoutSignatures(input)
  ) as unknown as SshRelayUnsignedArtifactManifest
  return validateUnsignedManifest(parsed)
}

export function parseSshRelayArtifactManifest(input: unknown): SshRelayArtifactManifest {
  const parsed = manifestSchema.parse(input) as unknown as SshRelayArtifactManifest
  validateUnsignedManifest(parsed)
  const signatureKeys = new Set<string>()
  for (const signature of parsed.signatures) {
    if (signatureKeys.has(signature.keyId)) {
      throw new Error(`SSH relay manifest has duplicate signature key: ${signature.keyId}`)
    }
    signatureKeys.add(signature.keyId)
  }
  return parsed
}

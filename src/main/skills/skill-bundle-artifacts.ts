import { app } from 'electron'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type {
  SkillBundleManifest,
  SkillReleaseMapping,
  SkillReleasedSnapshot,
  SkillSnapshotRegistry
} from '../../shared/skill-management'

export type SkillBundleArtifacts = {
  manifest: SkillBundleManifest
  registry: SkillSnapshotRegistry
  releaseMapping: SkillReleaseMapping
  releasedSnapshots: Record<string, SkillReleasedSnapshot[]>
  releasedAppVersions: Record<string, Record<number, string>>
  packagesRoot: string
}

function assertSupportedSchema(
  value: unknown,
  label: string
): asserts value is { schemaVersion: 1 } {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('schemaVersion' in value) ||
    value.schemaVersion !== 1
  ) {
    throw new Error(`Unsupported ${label} schema`)
  }
}

export async function loadSkillBundleArtifacts(
  resourceRoot = app.isPackaged ? process.resourcesPath : resolve(process.cwd(), 'resources')
): Promise<SkillBundleArtifacts> {
  const bundleRoot = join(resourceRoot, 'skills')
  const [manifest, registry, releaseMapping] = await Promise.all([
    readFile(join(bundleRoot, 'current-manifest.json'), 'utf8').then(JSON.parse),
    readFile(join(bundleRoot, 'snapshot-registry.json'), 'utf8').then(JSON.parse),
    readFile(join(bundleRoot, 'release-mapping.json'), 'utf8').then(JSON.parse)
  ])
  assertSupportedSchema(manifest, 'skill bundle manifest')
  assertSupportedSchema(registry, 'skill snapshot registry')
  assertSupportedSchema(releaseMapping, 'skill release mapping')
  if (!('skills' in manifest) || !Array.isArray(manifest.skills)) {
    throw new Error('Invalid skill bundle manifest')
  }
  if (!('appVersion' in manifest) || typeof manifest.appVersion !== 'string') {
    throw new Error('Invalid skill bundle manifest')
  }
  if (!('skills' in registry) || typeof registry.skills !== 'object' || registry.skills === null) {
    throw new Error('Invalid skill snapshot registry')
  }
  if (!('releases' in releaseMapping) || !Array.isArray(releaseMapping.releases)) {
    throw new Error('Invalid skill release mapping')
  }
  const mappedRevisions = new Map<string, Set<number>>()
  const releasedAppVersions: Record<string, Record<number, string>> = {}
  for (const release of releaseMapping.releases) {
    if (
      typeof release !== 'object' ||
      release === null ||
      !('appVersion' in release) ||
      typeof release.appVersion !== 'string' ||
      !('skills' in release) ||
      typeof release.skills !== 'object' ||
      release.skills === null
    ) {
      throw new Error('Invalid skill release mapping')
    }
    for (const [name, revision] of Object.entries(release.skills)) {
      if (!Number.isSafeInteger(revision) || (revision as number) <= 0) {
        throw new Error('Invalid skill release mapping')
      }
      const revisions = mappedRevisions.get(name) ?? new Set<number>()
      revisions.add(revision as number)
      mappedRevisions.set(name, revisions)
      releasedAppVersions[name] ??= {}
      releasedAppVersions[name][revision as number] ??= release.appVersion
    }
  }
  const releasedSnapshots = Object.fromEntries(
    Object.entries((registry as SkillSnapshotRegistry).skills).map(([name, snapshots]) => [
      name,
      snapshots.filter((snapshot) => mappedRevisions.get(name)?.has(snapshot.releaseRevision))
    ])
  )
  for (const [name, revisions] of mappedRevisions) {
    const known = new Set(
      ((registry as SkillSnapshotRegistry).skills[name] ?? []).map(
        (snapshot) => snapshot.releaseRevision
      )
    )
    if ([...revisions].some((revision) => !known.has(revision))) {
      throw new Error('Skill release mapping references an unknown snapshot')
    }
  }
  return {
    manifest: manifest as SkillBundleManifest,
    registry: registry as SkillSnapshotRegistry,
    releaseMapping: releaseMapping as SkillReleaseMapping,
    releasedSnapshots,
    releasedAppVersions,
    packagesRoot: app?.isPackaged ? join(bundleRoot, 'packages') : resolve(process.cwd(), 'skills')
  }
}

import type { Stats } from 'node:fs'
import { lstat, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { ExecutionHostId } from '../../shared/execution-host'
import { summarizeSkillMarkdown } from '../../shared/skill-metadata'
import type {
  SkillCurrentBundleEntry,
  SkillManagementInstallation,
  SkillManagementInventory,
  SkillManagementLedger
} from '../../shared/skill-management'
import { buildSkillDiscoverySources, type SkillScanRoot } from './skill-discovery-sources'
import { loadSkillBundleArtifacts, type SkillBundleArtifacts } from './skill-bundle-artifacts'
import { matchingReleasedSnapshot, observeSkillPackage } from './skill-package-identity'
import { skillAdoptionDismissalKey } from './skill-management-ledger'
import {
  createInaccessibleSkillCandidate,
  type ClassifiedSkillCandidate
} from './skill-management-inaccessible-candidate'
import {
  classifySkillInstallationTopology,
  type ClassifiedSkillTopology,
  normalizedSkillIdentityPath,
  skillDestinationId,
  skillTopologyPriority
} from './skill-installation-topology'
import { readOfficialSkillsCliLockEntries } from './skills-cli-lock-provenance'
import { runSkillCandidateTasks } from './skill-candidate-concurrency'
import { knownSkillManagementStatus } from './skill-management-status'

type CandidateLstat = (path: string) => Promise<Stats>
type CandidateTopology = (
  root: SkillScanRoot,
  unresolvedPath: string,
  canonicalRootPath: string
) => Promise<ClassifiedSkillTopology>

async function classifyCandidate(args: {
  root: SkillScanRoot
  name: string
  current: SkillCurrentBundleEntry
  artifacts: SkillBundleArtifacts
  ledger: SkillManagementLedger
  hostId: ExecutionHostId
  homeIdentity: string
  canonicalRootPath: string
  lockCorroboratedNames: ReadonlySet<string>
  actionsSupported: boolean
  candidateLstat: CandidateLstat
  classifyTopology: CandidateTopology
}): Promise<ClassifiedSkillCandidate | null> {
  const unresolvedPath = join(args.root.path, args.name)
  try {
    await args.candidateLstat(unresolvedPath)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null
    }
    return createInaccessibleSkillCandidate({ ...args, unresolvedPath, error })
  }
  let topology: ClassifiedSkillTopology
  try {
    topology = await args.classifyTopology(args.root, unresolvedPath, args.canonicalRootPath)
  } catch (error) {
    return createInaccessibleSkillCandidate({
      ...args,
      unresolvedPath,
      error,
      fallbackErrorCategory: 'skill-candidate-topology-failed'
    })
  }
  const base = {
    hostId: args.hostId,
    name: args.name,
    description: null,
    rootId: args.root.id,
    providers: args.root.providers,
    unresolvedPath,
    resolvedPath: topology.resolvedPath,
    physicalIdentity: topology.identity,
    topology: topology.topology,
    currentReleaseRevision: args.current.releaseRevision,
    currentPackageDigest: args.current.packageDigest,
    currentAppVersion: args.current.appVersion,
    errorCategory: topology.errorCategory,
    adoptionPromptEligible: false,
    lockCorroborated: args.root.id === 'home-agents' && args.lockCorroboratedNames.has(args.name),
    actionsSupported: args.hostId === 'local' && args.actionsSupported
  }
  if (!topology.resolvedPath || !topology.identity) {
    return {
      logicalEntryType: topology.entryType,
      installation: {
        ...base,
        id: skillDestinationId(args.hostId, unresolvedPath, args.name),
        status: 'inaccessible',
        eligible: false,
        managed: false,
        installedReleaseRevision: null,
        installedAppVersion: null,
        installedPackageDigest: null
      }
    }
  }

  const id = skillDestinationId(args.hostId, unresolvedPath, args.name)
  const managedRecord = args.ledger.destinations[id]
  if (topology.topology === 'external-link' || topology.topology === 'read-only') {
    return {
      logicalEntryType: topology.entryType,
      installation: {
        ...base,
        id,
        status: 'externally-managed',
        eligible: false,
        managed: false,
        installedReleaseRevision: null,
        installedAppVersion: null,
        installedPackageDigest: null
      }
    }
  }

  try {
    const observed = await observeSkillPackage(topology.resolvedPath)
    const skillMarkdown = observed.files.find((file) => file.path === 'SKILL.md')
    const description = skillMarkdown
      ? summarizeSkillMarkdown(skillMarkdown.bytes.toString('utf8')).description
      : null
    const match = matchingReleasedSnapshot(
      observed,
      args.artifacts.releasedSnapshots[args.name] ?? []
    )
    const managed = Boolean(
      managedRecord &&
      managedRecord.hostId === args.hostId &&
      managedRecord.homeIdentity === args.homeIdentity &&
      managedRecord.physicalIdentity === topology.identity &&
      match &&
      managedRecord.installedPackageDigest === match.packageDigest
    )
    return {
      logicalEntryType: topology.entryType,
      installation: {
        ...base,
        description,
        id,
        status: match
          ? managed && managedRecord?.lastOutcome === 'failed'
            ? 'update-failed'
            : knownSkillManagementStatus(
                managed,
                match.releaseRevision,
                args.current.releaseRevision
              )
          : managedRecord
            ? 'modified'
            : 'unknown',
        eligible: Boolean(match),
        managed,
        installedReleaseRevision: match?.releaseRevision ?? null,
        installedAppVersion: match
          ? (args.artifacts.releasedAppVersions[args.name]?.[match.releaseRevision] ?? null)
          : null,
        installedPackageDigest: match?.packageDigest ?? observed.observedDigest
      }
    }
  } catch (error) {
    return {
      logicalEntryType: topology.entryType,
      installation: {
        ...base,
        id,
        status: managedRecord ? 'modified' : 'unknown',
        eligible: false,
        managed: false,
        installedReleaseRevision: null,
        installedAppVersion: null,
        installedPackageDigest: null,
        errorCategory: error instanceof Error ? error.message : 'read-failed'
      }
    }
  }
}

export async function inventoryManagedSkills(args: {
  ledger: SkillManagementLedger
  hostId: ExecutionHostId
  homeDir: string
  resourceRoot?: string
  xdgStateHome?: string | null
  actionsSupported?: boolean
  candidateLstat?: CandidateLstat
  classifyTopology?: CandidateTopology
}): Promise<SkillManagementInventory> {
  const artifacts = await loadSkillBundleArtifacts(args.resourceRoot)
  const roots = buildSkillDiscoverySources({ homeDir: args.homeDir, cwd: args.homeDir }).filter(
    (root) => root.sourceKind === 'home'
  )
  const canonicalRootPath = roots.find((root) => root.id === 'home-agents')?.path
  if (!canonicalRootPath) {
    throw new Error('Missing canonical agent skills root')
  }
  const homeIdentity = normalizedSkillIdentityPath(
    await realpath(args.homeDir).catch(() => resolve(args.homeDir))
  )
  const lockCorroboratedNames = await readOfficialSkillsCliLockEntries({
    homeDir: args.homeDir,
    xdgStateHome:
      args.xdgStateHome === undefined
        ? args.hostId === 'local'
          ? process.env.XDG_STATE_HOME
          : null
        : args.xdgStateHome
  })
  const candidateTasks = artifacts.manifest.skills.flatMap((current) =>
    roots.map(
      (root) => () =>
        classifyCandidate({
          root,
          name: current.name,
          current,
          artifacts,
          ledger: args.ledger,
          hostId: args.hostId,
          homeIdentity,
          canonicalRootPath,
          lockCorroboratedNames,
          actionsSupported: args.actionsSupported ?? true,
          candidateLstat: args.candidateLstat ?? ((path) => lstat(path)),
          classifyTopology: args.classifyTopology ?? classifySkillInstallationTopology
        })
    )
  )
  // Why: each candidate may retain up to the package byte ceiling while it is
  // hashed, so mounted/focus inventory must not fan out across every root.
  const candidates = await runSkillCandidateTasks(candidateTasks)

  const deduped = new Map<string, SkillManagementInstallation>()
  for (const candidate of candidates) {
    if (!candidate) {
      continue
    }
    const installation = candidate.installation
    const key =
      installation.physicalIdentity && installation.topology !== 'external-link'
        ? `${installation.hostId}\0${installation.name}\0${installation.physicalIdentity}`
        : `${installation.hostId}\0${installation.unresolvedPath}`
    const existing = deduped.get(key)
    if (!existing) {
      deduped.set(key, installation)
      continue
    }
    const providers = [...new Set([...existing.providers, ...installation.providers])]
    if (skillTopologyPriority(installation.topology) > skillTopologyPriority(existing.topology)) {
      deduped.set(key, { ...installation, providers })
    } else {
      existing.providers = providers
    }
  }

  const dismissed = new Set(args.ledger.dismissedAdoptionCandidates.map(skillAdoptionDismissalKey))
  const installations = [...deduped.values()].sort(
    (left, right) =>
      left.name.localeCompare(right.name) || left.unresolvedPath.localeCompare(right.unresolvedPath)
  )
  for (const installation of installations) {
    installation.adoptionPromptEligible = Boolean(
      installation.eligible &&
      !installation.managed &&
      installation.physicalIdentity &&
      installation.installedPackageDigest &&
      !dismissed.has(
        skillAdoptionDismissalKey({
          hostId: installation.hostId,
          physicalIdentity: installation.physicalIdentity,
          skillName: installation.name,
          snapshotDigest: installation.installedPackageDigest
        })
      )
    )
  }
  const adoptionCandidateCount = installations.filter(
    (installation) => installation.adoptionPromptEligible
  ).length

  return {
    schemaVersion: 1,
    hostId: args.hostId,
    installations,
    adoptionCandidateCount,
    scannedAt: Date.now()
  }
}

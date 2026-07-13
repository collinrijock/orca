import {
  cp,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  truncate,
  unlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ManagedSkillDestination, SkillManagementLedger } from '../../shared/skill-management'
import { emptySkillManagementLedger } from './skill-management-ledger'
import { inventoryManagedSkills } from './skill-management-inventory'
import { classifySkillInstallationTopology } from './skill-installation-topology'

const resourceRoot = resolve('resources')
const temporaryHomes: string[] = []

async function createHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'orca-skill-inventory-'))
  temporaryHomes.push(home)
  return home
}

async function installSkill(
  home: string,
  root: '.agents' | '.codex',
  name: string
): Promise<string> {
  const destination = join(home, root, 'skills', name)
  await mkdir(dirname(destination), { recursive: true })
  await cp(resolve('skills', name), destination, { recursive: true })
  return destination
}

afterEach(async () => {
  await Promise.all(temporaryHomes.splice(0).map((home) => rm(home, { recursive: true })))
})

describe('managed skill inventory', () => {
  it('recognizes an exact current canonical installation as adoptable', async () => {
    const home = await createHome()
    await installSkill(home, '.agents', 'orca-cli')

    const inventory = await inventoryManagedSkills({
      ledger: emptySkillManagementLedger(),
      hostId: 'local',
      homeDir: home,
      resourceRoot
    })
    const installation = inventory.installations.find((entry) => entry.name === 'orca-cli')

    expect(installation).toMatchObject({
      topology: 'canonical-copy',
      status: 'known-current',
      eligible: true,
      managed: false
    })
    expect(inventory.adoptionCandidateCount).toBe(1)
  })

  it('suppresses only the explicitly dismissed destination snapshot tuple', async () => {
    const home = await createHome()
    await installSkill(home, '.agents', 'orca-cli')
    await installSkill(home, '.agents', 'computer-use')
    const initial = await inventoryManagedSkills({
      ledger: emptySkillManagementLedger(),
      hostId: 'local',
      homeDir: home,
      resourceRoot
    })
    const dismissed = initial.installations.find((entry) => entry.name === 'orca-cli')!

    const next = await inventoryManagedSkills({
      ledger: {
        schemaVersion: 1,
        destinations: {},
        dismissedAdoptionCandidates: [
          {
            hostId: dismissed.hostId,
            physicalIdentity: dismissed.physicalIdentity!,
            skillName: dismissed.name,
            snapshotDigest: dismissed.installedPackageDigest!,
            dismissedAt: 1
          }
        ]
      },
      hostId: 'local',
      homeDir: home,
      resourceRoot
    })

    expect(next.installations.find((entry) => entry.name === 'orca-cli')).toMatchObject({
      adoptionPromptEligible: false
    })
    expect(next.installations.find((entry) => entry.name === 'computer-use')).toMatchObject({
      adoptionPromptEligible: true
    })
  })

  it('does not adopt a registry snapshot absent from the release mapping', async () => {
    const home = await createHome()
    await installSkill(home, '.agents', 'orca-cli')
    const isolatedResources = join(home, 'resources')
    await cp(resolve('resources/skills'), join(isolatedResources, 'skills'), { recursive: true })
    const mappingPath = join(isolatedResources, 'skills', 'release-mapping.json')
    const mapping = JSON.parse(await readFile(mappingPath, 'utf8')) as {
      releases: { skills: Record<string, number> }[]
    }
    const manifest = JSON.parse(
      await readFile(join(isolatedResources, 'skills', 'current-manifest.json'), 'utf8')
    ) as { skills: { name: string; releaseRevision: number }[] }
    const currentRevision = manifest.skills.find(
      (skill) => skill.name === 'orca-cli'
    )!.releaseRevision
    for (const release of mapping.releases) {
      if (release.skills['orca-cli'] === currentRevision) {
        delete release.skills['orca-cli']
      }
    }
    await writeFile(mappingPath, JSON.stringify(mapping))

    const inventory = await inventoryManagedSkills({
      ledger: emptySkillManagementLedger(),
      hostId: 'local',
      homeDir: home,
      resourceRoot: isolatedResources
    })

    expect(inventory.installations.find((entry) => entry.name === 'orca-cli')).toMatchObject({
      status: 'unknown',
      eligible: false
    })
  })

  it('recognizes exact hardlinked files because publication replaces directory entries', async () => {
    const home = await createHome()
    const destination = await installSkill(home, '.agents', 'orca-cli')
    const skillMarkdown = join(destination, 'SKILL.md')
    const alias = join(home, 'hardlink-alias')
    await link(skillMarkdown, alias)

    const inventory = await inventoryManagedSkills({
      ledger: emptySkillManagementLedger(),
      hostId: 'local',
      homeDir: home,
      resourceRoot
    })
    // Why: staged publish uses rename/temp+rename, which breaks the hardlink
    // instead of writing through to the other linked file.
    expect(inventory.installations.find((entry) => entry.name === 'orca-cli')).toMatchObject({
      status: 'known-current',
      eligible: true
    })
    await unlink(alias)
  })

  it('treats CRLF-only installer output as the same released text snapshot', async () => {
    const home = await createHome()
    const destination = await installSkill(home, '.agents', 'orca-cli')
    const skillPath = join(destination, 'SKILL.md')
    const source = await readFile(skillPath, 'utf8')
    await writeFile(skillPath, source.replace(/\n/g, '\r\n'))

    const inventory = await inventoryManagedSkills({
      ledger: emptySkillManagementLedger(),
      hostId: 'local',
      homeDir: home,
      resourceRoot
    })

    expect(inventory.installations.find((entry) => entry.name === 'orca-cli')?.status).toBe(
      'known-current'
    )
  })

  it('fails closed after an adopted package is edited', async () => {
    const home = await createHome()
    const destination = await installSkill(home, '.agents', 'orca-cli')
    const initial = await inventoryManagedSkills({
      ledger: emptySkillManagementLedger(),
      hostId: 'local',
      homeDir: home,
      resourceRoot
    })
    const installation = initial.installations.find((entry) => entry.name === 'orca-cli')
    expect(installation?.physicalIdentity).toBeTruthy()
    expect(installation?.installedPackageDigest).toBeTruthy()
    const record: ManagedSkillDestination = {
      id: installation!.id,
      hostId: 'local',
      homeIdentity: home,
      rootId: 'home-agents',
      unresolvedPath: destination,
      resolvedPath: destination,
      physicalIdentity: installation!.physicalIdentity!,
      entryType: 'directory',
      skillName: 'orca-cli',
      source: 'stablyai/orca',
      sourcePath: 'skills/orca-cli',
      sourceRef: null,
      installedReleaseRevision: installation!.installedReleaseRevision!,
      installedPackageDigest: installation!.installedPackageDigest!,
      installedFiles: [],
      lastWrittenPackageDigest: null,
      lastAttemptedBundleFingerprint: null,
      lastOutcome: 'adopted',
      lastErrorCategory: null,
      adoptedFrom: 'exact-snapshot',
      adoptedAt: 1,
      updatedAt: 1
    }
    const ledger: SkillManagementLedger = {
      schemaVersion: 1,
      destinations: { [record.id]: record },
      dismissedAdoptionCandidates: []
    }
    await writeFile(join(destination, 'extra.txt'), 'local edit')

    const inventory = await inventoryManagedSkills({
      ledger,
      hostId: 'local',
      homeDir: home,
      resourceRoot
    })

    expect(inventory.installations.find((entry) => entry.name === 'orca-cli')).toMatchObject({
      status: 'modified',
      eligible: false,
      managed: false
    })
  })

  it('bounds one oversized candidate without hiding healthy siblings', async () => {
    const home = await createHome()
    const oversized = await installSkill(home, '.agents', 'orca-cli')
    await installSkill(home, '.agents', 'computer-use')
    const oversizedFile = join(oversized, 'oversized.bin')
    await writeFile(oversizedFile, '')
    await truncate(oversizedFile, 4 * 1024 * 1024 + 1)

    const inventory = await inventoryManagedSkills({
      ledger: emptySkillManagementLedger(),
      hostId: 'local',
      homeDir: home,
      resourceRoot
    })

    expect(inventory.installations.find((entry) => entry.name === 'orca-cli')).toMatchObject({
      status: 'unknown',
      errorCategory: 'skill-package-file-size-limit'
    })
    expect(inventory.installations.find((entry) => entry.name === 'computer-use')).toMatchObject({
      status: 'known-current',
      eligible: true
    })
  })

  it('classifies one candidate lstat failure without rejecting healthy siblings', async () => {
    const home = await createHome()
    await installSkill(home, '.agents', 'orca-cli')

    const inventory = await inventoryManagedSkills({
      ledger: emptySkillManagementLedger(),
      hostId: 'local',
      homeDir: home,
      resourceRoot,
      candidateLstat: async (path) => {
        if (path.includes(`${join(home, '.codex')}`) && path.endsWith('orca-cli')) {
          throw Object.assign(new Error('denied'), { code: 'EACCES' })
        }
        return lstat(path)
      }
    })

    expect(
      inventory.installations.find(
        (entry) => entry.name === 'orca-cli' && entry.status === 'inaccessible'
      )
    ).toMatchObject({ errorCategory: 'skill-candidate-access-denied' })
    expect(
      inventory.installations.find(
        (entry) => entry.name === 'orca-cli' && entry.status === 'known-current'
      )
    ).toBeTruthy()
  })

  it('classifies a topology race without rejecting healthy siblings', async () => {
    const home = await createHome()
    await installSkill(home, '.agents', 'orca-cli')
    await installSkill(home, '.codex', 'orca-cli')

    const inventory = await inventoryManagedSkills({
      ledger: emptySkillManagementLedger(),
      hostId: 'local',
      homeDir: home,
      resourceRoot,
      classifyTopology: async (root, path, canonicalRootPath) => {
        if (root.id === 'home-codex' && path.endsWith('orca-cli')) {
          throw Object.assign(new Error('raced'), { code: 'EIO' })
        }
        return classifySkillInstallationTopology(root, path, canonicalRootPath)
      }
    })

    expect(
      inventory.installations.find(
        (entry) => entry.name === 'orca-cli' && entry.status === 'inaccessible'
      )
    ).toMatchObject({ errorCategory: 'skill-candidate-topology-failed' })
    expect(
      inventory.installations.find(
        (entry) => entry.name === 'orca-cli' && entry.status === 'known-current'
      )
    ).toBeTruthy()
  })

  it('caps concurrent candidate filesystem observations', async () => {
    const home = await createHome()
    let active = 0
    let peak = 0

    await inventoryManagedSkills({
      ledger: emptySkillManagementLedger(),
      hostId: 'local',
      homeDir: home,
      resourceRoot,
      candidateLstat: async () => {
        active += 1
        peak = Math.max(peak, active)
        await new Promise<void>((resolve) => queueMicrotask(resolve))
        active -= 1
        throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      }
    })

    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(4)
  })

  it.runIf(process.platform !== 'win32')(
    'deduplicates a provider alias into its canonical physical copy',
    async () => {
      const home = await createHome()
      const destination = await installSkill(home, '.agents', 'orca-cli')
      const alias = join(home, '.claude', 'skills', 'orca-cli')
      await mkdir(dirname(alias), { recursive: true })
      await symlink(relative(dirname(alias), destination), alias)

      const inventory = await inventoryManagedSkills({
        ledger: emptySkillManagementLedger(),
        hostId: 'local',
        homeDir: home,
        resourceRoot
      })
      const matches = inventory.installations.filter((entry) => entry.name === 'orca-cli')

      expect(matches).toHaveLength(1)
      expect(matches[0]).toMatchObject({
        topology: 'canonical-copy',
        providers: expect.arrayContaining(['agent-skills', 'codex', 'claude'])
      })
    }
  )
})

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const MACOS_CODEX_PREFERENCES_DOMAIN = 'com.openai.codex'
const MACOS_REQUIREMENTS_KEY = 'requirements_toml_base64'
const UNIX_REQUIREMENTS_PATH = '/etc/codex/requirements.toml'
const WINDOWS_REQUIREMENTS_PATH = join(
  process.env.ProgramData ?? 'C:\\ProgramData',
  'OpenAI',
  'Codex',
  'requirements.toml'
)

const KNOWN_BAD_WARNING_LINES = [
  'Orca did not start Codex because this Mac has managed Codex requirements with network.enabled = true in a permission profile.',
  'Codex CLI currently exits with "turn/start failed in TUI" for that managed network policy.',
  'Ask your Codex administrator to remove that network.enabled requirement or update Codex after the upstream fix lands.'
] as const

export function buildCodexManagedNetworkRequirementsWarningCommand(): string {
  return `printf '%s\\n' ${KNOWN_BAD_WARNING_LINES.map(shellQuote).join(' ')}`
}

export function hasManagedCodexNetworkPermissionRequirement(): boolean {
  return getManagedRequirementsTomlCandidates().some(hasNetworkEnabledPermissionProfile)
}

function getManagedRequirementsTomlCandidates(): string[] {
  const candidates: string[] = []
  const mdmRequirements = readMacosMdmRequirementsToml()
  if (mdmRequirements) {
    candidates.push(mdmRequirements)
  }

  const filePath = process.platform === 'win32' ? WINDOWS_REQUIREMENTS_PATH : UNIX_REQUIREMENTS_PATH
  const fileRequirements = readRequirementsFile(filePath)
  if (fileRequirements) {
    candidates.push(fileRequirements)
  }
  return candidates
}

function readMacosMdmRequirementsToml(): string | null {
  if (process.platform !== 'darwin') {
    return null
  }
  try {
    const encoded = execFileSync(
      'defaults',
      ['read', MACOS_CODEX_PREFERENCES_DOMAIN, MACOS_REQUIREMENTS_KEY],
      {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 1000
      }
    ).trim()
    if (!encoded) {
      return null
    }
    return Buffer.from(encoded, 'base64').toString('utf-8')
  } catch {
    return null
  }
}

function readRequirementsFile(path: string): string | null {
  try {
    return existsSync(path) ? readFileSync(path, 'utf-8') : null
  } catch {
    return null
  }
}

function hasNetworkEnabledPermissionProfile(toml: string): boolean {
  let inPermissionNetworkSection = false
  for (const rawLine of toml.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.startsWith('[')) {
      inPermissionNetworkSection = /^\[permissions\..+\.network\]\s*(?:#.*)?$/.test(line)
      continue
    }
    if (!inPermissionNetworkSection) {
      continue
    }
    if (/^enabled\s*=\s*true\s*(?:#.*)?$/i.test(line)) {
      return true
    }
  }
  return false
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import process from 'node:process'

import { parse, printParseErrorCode } from 'jsonc-parser'

const MANIFEST_PATH = path.join('config', 'reliability-gates.jsonc')
const RED_GREEN_STATUSES = new Set(['missing', 'partial', 'complete', 'not-required'])
const FLAKE_STATUSES = new Set(['not-started', 'unknown', 'soaking', 'stable', 'flaky'])

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function hasNonEmptyStringArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString)
}

function requireNonEmptyString(gate, field, failures) {
  if (!isNonEmptyString(gate[field])) {
    failures.push(`${gate.id ?? '<unknown>'}: ${field} must be a non-empty string`)
  }
}

function requireStringArray(gate, field, failures) {
  if (!hasNonEmptyStringArray(gate[field])) {
    failures.push(`${gate.id ?? '<unknown>'}: ${field} must be a non-empty string array`)
  }
}

function requireNonNegativeNumber(record, field, owner, failures) {
  if (!Number.isFinite(record[field]) || record[field] < 0) {
    failures.push(`${owner}.${field} must be a non-negative number`)
  }
}

function validatePolicy(manifest, failures) {
  if (!isRecord(manifest.policy)) {
    failures.push('policy must be an object')
    return new Set()
  }
  if (!hasNonEmptyStringArray(manifest.policy.maturityLevels)) {
    failures.push('policy.maturityLevels must be a non-empty string array')
  }
  if (!isRecord(manifest.policy.blockingPromotion)) {
    failures.push('policy.blockingPromotion must be an object')
  } else {
    for (const field of ['minimumSoakRuns', 'minimumSoakDays', 'maximumUnexplainedFlakes']) {
      requireNonNegativeNumber(
        manifest.policy.blockingPromotion,
        field,
        'policy.blockingPromotion',
        failures
      )
    }
  }
  return new Set(
    Array.isArray(manifest.policy.maturityLevels)
      ? manifest.policy.maturityLevels.filter(isNonEmptyString)
      : []
  )
}

function validateRuntimeBudget(gate, failures) {
  if (!isRecord(gate.runtimeBudget)) {
    failures.push(`${gate.id}: runtimeBudget must be an object`)
    return
  }
  if (!Number.isFinite(gate.runtimeBudget.p95Seconds) || gate.runtimeBudget.p95Seconds <= 0) {
    failures.push(`${gate.id}: runtimeBudget.p95Seconds must be a positive number`)
  }
  if (!isNonEmptyString(gate.runtimeBudget.scope)) {
    failures.push(`${gate.id}: runtimeBudget.scope must be a non-empty string`)
  }
}

function validateEvidence(gate, field, allowedStatuses, failures) {
  const evidence = gate[field]
  if (!isRecord(evidence)) {
    failures.push(`${gate.id}: ${field} must be an object`)
    return
  }
  if (!allowedStatuses.has(evidence.status)) {
    failures.push(`${gate.id}: ${field}.status is invalid`)
  }
  if (!isNonEmptyString(evidence.evidence)) {
    failures.push(`${gate.id}: ${field}.evidence must be a non-empty string`)
  }
}

function validatePerformanceBudget(gate, failures) {
  if (!isRecord(gate.performanceBudget)) {
    failures.push(`${gate.id}: performanceBudget must be an object`)
    return
  }
  if (typeof gate.performanceBudget.required !== 'boolean') {
    failures.push(`${gate.id}: performanceBudget.required must be boolean`)
  }
  if (!isNonEmptyString(gate.performanceBudget.evidence)) {
    failures.push(`${gate.id}: performanceBudget.evidence must be a non-empty string`)
  }
}

function validateGate(gate, maturities) {
  const failures = []
  if (!isRecord(gate)) {
    return ['gate entry must be an object']
  }
  for (const field of ['id', 'title', 'owner', 'layer', 'invariant', 'oracle', 'demotionRule']) {
    requireNonEmptyString(gate, field, failures)
  }
  if (!maturities.has(gate.maturity)) {
    failures.push(`${gate.id ?? '<unknown>'}: maturity is invalid`)
  }
  for (const field of [
    'surfaces',
    'platforms',
    'providers',
    'motivatingLinks',
    'promotionCriteria'
  ]) {
    requireStringArray(gate, field, failures)
  }
  if (!Array.isArray(gate.commands) || !gate.commands.every(isNonEmptyString)) {
    failures.push(`${gate.id}: commands must be an array of strings`)
  }
  if (!Array.isArray(gate.testFiles) || !gate.testFiles.every(isNonEmptyString)) {
    failures.push(`${gate.id}: testFiles must be an array of strings`)
  }
  if (['soak', 'blocking'].includes(gate.maturity)) {
    if (!hasNonEmptyStringArray(gate.commands)) {
      failures.push(`${gate.id}: ${gate.maturity} gates must declare at least one command`)
    }
    if (!hasNonEmptyStringArray(gate.testFiles)) {
      failures.push(`${gate.id}: ${gate.maturity} gates must declare at least one test file`)
    }
  }
  validateRuntimeBudget(gate, failures)
  validateEvidence(gate, 'flakeHistory', FLAKE_STATUSES, failures)
  validateEvidence(gate, 'redGreenEvidence', RED_GREEN_STATUSES, failures)
  validatePerformanceBudget(gate, failures)
  if (!Array.isArray(gate.knownGaps) || !gate.knownGaps.every(isNonEmptyString)) {
    failures.push(`${gate.id}: knownGaps must be an array of strings`)
  }
  return failures
}

export async function main(root = process.cwd()) {
  const manifestPath = path.join(root, MANIFEST_PATH)
  let raw
  try {
    raw = await fs.readFile(manifestPath, 'utf8')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`${MANIFEST_PATH}: unable to read manifest (${message})`)
    return 1
  }
  const parseErrors = []
  const manifest = parse(raw, parseErrors, { allowTrailingComma: true })
  if (parseErrors.length > 0) {
    for (const error of parseErrors) {
      console.error(
        `${MANIFEST_PATH}: JSONC parse error ${printParseErrorCode(error.error)} at offset ${error.offset}`
      )
    }
    return 1
  }
  const failures = []
  if (!isRecord(manifest)) {
    failures.push('manifest must be an object')
  } else {
    if (manifest.schemaVersion !== 1) {
      failures.push('schemaVersion must be 1')
    }
    const maturities = validatePolicy(manifest, failures)
    if (!Array.isArray(manifest.gates) || manifest.gates.length === 0) {
      failures.push('gates must be a non-empty array')
    } else {
      const seenIds = new Set()
      for (const gate of manifest.gates) {
        if (isRecord(gate) && isNonEmptyString(gate.id)) {
          if (seenIds.has(gate.id)) {
            failures.push(`${gate.id}: duplicate gate id`)
          }
          seenIds.add(gate.id)
        }
        failures.push(...validateGate(gate, maturities))
      }
    }
  }
  if (failures.length > 0) {
    console.error(`Reliability gate manifest check failed with ${failures.length} issue(s):`)
    for (const failure of failures) {
      console.error(`- ${failure}`)
    }
    return 1
  }
  console.log(`Reliability gate manifest check passed for ${manifest.gates.length} gate(s).`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main())
}

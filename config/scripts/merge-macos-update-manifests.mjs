#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { parse, stringify } from 'yaml'

export function mergeMacUpdateManifests(primaryText, secondaryText) {
  const primary = parseManifest(primaryText, 'primary')
  const secondary = parseManifest(secondaryText, 'secondary')

  if (primary.version !== secondary.version) {
    throw new Error(
      `Cannot merge macOS update manifests with different versions: ${primary.version} != ${secondary.version}`
    )
  }

  const filesByUrl = new Map()
  for (const file of [...primary.files, ...secondary.files]) {
    const key = file.url ?? file.path
    if (!key) {
      throw new Error('Cannot merge macOS update manifest file without url or path')
    }
    filesByUrl.set(key, file)
  }

  return stringify({
    ...primary,
    files: [...filesByUrl.values()]
  })
}

function parseManifest(text, label) {
  const manifest = parse(text)
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error(`Invalid ${label} macOS update manifest: expected an object`)
  }
  if (!Array.isArray(manifest.files)) {
    throw new Error(`Invalid ${label} macOS update manifest: missing files array`)
  }
  return manifest
}

export function mergeMacUpdateManifestFiles(primaryPath, secondaryPath, outputPath = primaryPath) {
  const merged = mergeMacUpdateManifests(
    readFileSync(primaryPath, 'utf8'),
    readFileSync(secondaryPath, 'utf8')
  )
  writeFileSync(outputPath, merged, 'utf8')
}

async function main() {
  const [, , primaryPath, secondaryPath, outputPath] = process.argv
  if (!primaryPath || !secondaryPath) {
    throw new Error(
      'Usage: node config/scripts/merge-macos-update-manifests.mjs <primary.yml> <secondary.yml> [output.yml]'
    )
  }
  mergeMacUpdateManifestFiles(primaryPath, secondaryPath, outputPath)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}

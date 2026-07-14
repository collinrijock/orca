import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const LINKER_OPTIONS = `            'VCLinkerTool': {
              'AdditionalOptions': [
                '/DYNAMICBASE',
                '/guard:cf'
              ]
            }`

const REPRODUCIBLE_LINKER_OPTIONS = `            'VCLinkerTool': {
              'AdditionalOptions': [
                '/DYNAMICBASE',
                '/guard:cf',
                '/Brepro'
              ]
            }`

export async function applyWindowsNodePtyBuildDeterminism({ nodePtyDirectory, tuple }) {
  if (!tuple.startsWith('win32-')) {
    return false
  }
  const bindingPath = join(nodePtyDirectory, 'binding.gyp')
  const source = await readFile(bindingPath, 'utf8')
  if (source.split(LINKER_OPTIONS).length !== 2 || source.includes("'/Brepro'")) {
    throw new Error('node-pty Windows linker settings do not match the reviewed source')
  }
  // Why: MSVC otherwise embeds per-build timestamps/identities in the copied artifact binaries.
  await writeFile(bindingPath, source.replace(LINKER_OPTIONS, REPRODUCIBLE_LINKER_OPTIONS), 'utf8')
  return true
}

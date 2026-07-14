import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const COMPILER_OPTIONS = `            'VCCLCompilerTool': {
              'AdditionalOptions': [
                '/guard:cf',
                '/sdl',
                '/W3',
                '/w34244',
                '/w34267',
                '/ZH:SHA_256'
              ]
            }`

const REPRODUCIBLE_COMPILER_OPTIONS = `            'VCCLCompilerTool': {
              'AdditionalOptions': [
                '/guard:cf',
                '/sdl',
                '/W3',
                '/w34244',
                '/w34267',
                '/ZH:SHA_256',
                '/Brepro',
                '/experimental:deterministic'
              ]
            }`

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
                '/Brepro',
                '/experimental:deterministic'
              ]
            }`

const REQUIRED_GENERATED_OPTIONS = ['/Brepro', '/experimental:deterministic']

function decodeXmlText(value) {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
}

function releaseDefinitionGroup(source, configuration) {
  const groups = [
    ...source.matchAll(/<ItemDefinitionGroup\b([^>]*)>([\s\S]*?)<\/ItemDefinitionGroup>/g)
  ].filter((match) => decodeXmlText(match[1]).includes(`'Release|${configuration}'`))
  if (groups.length !== 1) {
    throw new Error('generated MSBuild settings lack one exact Release configuration')
  }
  return groups[0][2]
}

function requiredToolOptions(group, tool) {
  const tools = [...group.matchAll(new RegExp(`<${tool}\\b[^>]*>([\\s\\S]*?)</${tool}>`, 'g'))]
  const options = tools.flatMap((match) => [
    ...match[1].matchAll(/<AdditionalOptions\b[^>]*>([\s\S]*?)<\/AdditionalOptions>/g)
  ])
  if (tools.length !== 1 || options.length !== 1) {
    throw new Error(`generated MSBuild settings lack one exact ${tool} option block`)
  }
  const tokens = decodeXmlText(options[0][1]).trim().split(/\s+/)
  if (!tokens.includes('%(AdditionalOptions)')) {
    throw new Error(`generated MSBuild settings do not inherit ${tool} options`)
  }
  for (const required of REQUIRED_GENERATED_OPTIONS) {
    const count = tokens.filter((token) => token.toLowerCase() === required.toLowerCase()).length
    if (count !== 1) {
      throw new Error(`generated MSBuild settings require exactly one ${tool} ${required}`)
    }
  }
  return [...REQUIRED_GENERATED_OPTIONS]
}

export async function applyWindowsNodePtyBuildDeterminism({ nodePtyDirectory, tuple }) {
  if (!tuple.startsWith('win32-')) {
    return false
  }
  const bindingPath = join(nodePtyDirectory, 'binding.gyp')
  const source = await readFile(bindingPath, 'utf8')
  if (
    source.split(COMPILER_OPTIONS).length !== 2 ||
    source.split(LINKER_OPTIONS).length !== 2 ||
    source.includes("'/Brepro'") ||
    source.includes("'/experimental:deterministic'")
  ) {
    throw new Error('node-pty Windows build settings do not match the reviewed source')
  }
  // Why: ARM64 compiler output changes even with a reproducible linker unless both stages opt in.
  const reproducibleSource = source
    .replace(COMPILER_OPTIONS, REPRODUCIBLE_COMPILER_OPTIONS)
    .replace(LINKER_OPTIONS, REPRODUCIBLE_LINKER_OPTIONS)
  await writeFile(bindingPath, reproducibleSource, 'utf8')
  return true
}

export async function assertWindowsNodePtyGeneratedBuildSettings({ nodePtyDirectory, tuple }) {
  if (!tuple.startsWith('win32-')) {
    return undefined
  }
  const project = 'conpty_console_list.vcxproj'
  const configuration = `Release|${tuple.endsWith('-arm64') ? 'ARM64' : 'x64'}`
  const source = await readFile(join(nodePtyDirectory, 'build', project), 'utf8')
  const group = releaseDefinitionGroup(source, configuration.split('|')[1])
  // Why: the source rewrite is insufficient proof unless gyp propagates both stages into MSBuild.
  return {
    configuration,
    compilerOptions: requiredToolOptions(group, 'ClCompile'),
    linkerOptions: requiredToolOptions(group, 'Link'),
    project
  }
}

import {
  createTomlLineScanState,
  getTomlTableHeader,
  isTomlStructuralLine,
  parseTomlSingleLineStringValue,
  updateTomlLineScanState
} from './config-toml-line-scan'

// Why: only the root setting selects the provider for every OAuth login;
// similarly named keys inside profiles or provider tables are not global pins.
export function readCodexTopLevelModelProvider(config: string): string | null {
  let state = createTomlLineScanState()
  for (const line of config.split('\n')) {
    if (isTomlStructuralLine(state)) {
      if (getTomlTableHeader(line)) {
        return null
      }
      const match = /^[ \t]*(?:model_provider|"model_provider"|'model_provider')[ \t]*=/.exec(line)
      if (match) {
        return parseTomlSingleLineStringValue(line, match[0].length)?.value ?? null
      }
    }
    state = updateTomlLineScanState(state, line)
  }
  return null
}

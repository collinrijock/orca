export type CommandErrorData = {
  nextSteps: string[]
}

export type FlagErrorData = {
  validFlags: string[]
  nextSteps: string[]
}

// Why: route typos to read-only discovery so agents never execute a guessed command.
export function unknownCommandData(): CommandErrorData {
  return {
    nextSteps: [
      'Run `orca help` or `orca agent-context --json` to inspect available commands before retrying.'
    ]
  }
}

export function unknownFlagData(
  validFlags: string[],
  commandPath: readonly string[] = []
): FlagErrorData {
  const helpCommand = commandPath.length > 0 ? `orca help ${commandPath.join(' ')}` : 'orca help'
  // Why: flag guesses can activate --force; exact help keeps intent explicit.
  return {
    validFlags: [...validFlags].sort((a, b) => a.localeCompare(b)),
    nextSteps: [`Run \`${helpCommand}\` to inspect supported flags before retrying.`]
  }
}

import type { HookCommandConfig, HookDefinition } from '../agent-hooks/installer-utils'
import { runCodexUserHookTrustRebaseSessionSync } from './codex-app-server-grant-bridge'
import { createCodexHookTrustEntry } from './codex-hook-identity'
import { resolveCodexTrustGrantHost } from './codex-trust-grant-host'
import {
  captureCodexTrustConfig,
  restoreCodexTrustConfig,
  type CodexTrustConfigSnapshot
} from './codex-trust-config-rollback'
import { computeTrustKey, type CodexTrustEntry } from './config-toml-trust'
import type {
  CodexUserHookTrustRebaseRequest,
  CodexUserHookTrustRebaseResult,
  CodexUserHookTrustMove
} from './codex-user-hook-trust-rebase-client'

type HooksByEvent = Record<string, HookDefinition[]>

type RebaseSessionRunnerSync = (
  request: CodexUserHookTrustRebaseRequest
) => CodexUserHookTrustRebaseResult

let runSessionSync: RebaseSessionRunnerSync = runCodexUserHookTrustRebaseSessionSync

function entriesByHookObject(
  sourcePath: string,
  hooksByEvent: HooksByEvent
): Map<HookCommandConfig, CodexTrustEntry> {
  const result = new Map<HookCommandConfig, CodexTrustEntry>()
  for (const [eventName, definitions] of Object.entries(hooksByEvent)) {
    if (!Array.isArray(definitions)) {
      continue
    }
    definitions.forEach((definition, groupIndex) => {
      if (!Array.isArray(definition.hooks)) {
        return
      }
      definition.hooks.forEach((hook, handlerIndex) => {
        const entry = createCodexHookTrustEntry(
          sourcePath,
          eventName,
          groupIndex,
          handlerIndex,
          definition,
          hook
        )
        if (entry) {
          result.set(hook, entry)
        }
      })
    })
  }
  return result
}

export function getMovedCodexUserHookTrust(
  sourcePath: string,
  beforeHooks: HooksByEvent,
  afterHooks: HooksByEvent
): CodexUserHookTrustMove[] {
  const before = entriesByHookObject(sourcePath, beforeHooks)
  const after = entriesByHookObject(sourcePath, afterHooks)
  const moves: CodexUserHookTrustMove[] = []
  for (const [hook, oldEntry] of before) {
    const newEntry = after.get(hook)
    if (!newEntry) {
      continue
    }
    const oldKey = computeTrustKey(oldEntry)
    const newKey = computeTrustKey(newEntry)
    if (oldKey !== newKey) {
      moves.push({ oldKey, newKey, command: oldEntry.command })
    }
  }
  return moves
}

function rollbackMutation(
  restoreHooks: () => void,
  tomlPath: string,
  snapshot: CodexTrustConfigSnapshot,
  originalError: unknown
): never {
  const rollbackErrors: unknown[] = []
  try {
    restoreHooks()
  } catch (error) {
    rollbackErrors.push(error)
  }
  try {
    restoreCodexTrustConfig(tomlPath, snapshot)
  } catch (error) {
    rollbackErrors.push(error)
  }
  if (rollbackErrors.length > 0) {
    throw new AggregateError(
      [originalError, ...rollbackErrors],
      'Failed to rebase moved user hook trust and restore the original files'
    )
  }
  throw originalError
}

export function mutateRealHomeHooksPreservingUserTrust(args: {
  sourcePath: string
  runtimeHomePath: string
  tomlPath: string
  beforeHooks: HooksByEvent
  afterHooks: HooksByEvent
  writeHooks: () => void
  restoreHooks: () => void
}): CodexTrustConfigSnapshot | null {
  const moves = getMovedCodexUserHookTrust(args.sourcePath, args.beforeHooks, args.afterHooks)
  if (moves.length === 0) {
    args.writeHooks()
    return null
  }
  const snapshot = captureCodexTrustConfig(args.tomlPath)

  const baseRequest = resolveCodexTrustGrantHost({ kind: 'native' }).buildRequest({
    runtimeHomePath: args.runtimeHomePath,
    managedCommand: '',
    expectedTrustKeys: []
  })
  // Why: inspection happens before the write, so an unavailable RPC aborts
  // without shifting a user's positional trust key.
  const inspected: CodexUserHookTrustRebaseResult = runSessionSync({
    operation: 'inspect-user-hook-trust',
    invocation: baseRequest.invocation,
    hooksListCwd: baseRequest.hooksListCwd,
    moves
  })
  if (inspected.outcome !== 'inspected') {
    throw new Error('Unexpected Codex user hook trust inspection result')
  }

  let hooksWritten = false
  try {
    args.writeHooks()
    hooksWritten = true
    const repaired = runSessionSync({
      operation: 'repair-user-hook-trust',
      invocation: baseRequest.invocation,
      hooksListCwd: baseRequest.hooksListCwd,
      moves: inspected.moves
    })
    if (repaired.outcome !== 'repaired') {
      throw new Error('Unexpected Codex user hook trust repair result')
    }
    return snapshot
  } catch (error) {
    if (hooksWritten) {
      return rollbackMutation(args.restoreHooks, args.tomlPath, snapshot, error)
    }
    throw error
  }
}

export const _internals = {
  setSessionRunnerSync(runner: RebaseSessionRunnerSync | null): void {
    runSessionSync = runner ?? runCodexUserHookTrustRebaseSessionSync
  }
}

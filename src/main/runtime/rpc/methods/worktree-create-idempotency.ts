import { isDeepStrictEqual } from 'node:util'
import { InvalidArgumentError } from '../core'

const WORKTREE_CREATE_RESULT_TTL_MS = 5 * 60_000

type WorktreeCreateEntry = {
  params: unknown
  result: Promise<unknown>
}

const worktreeCreatesByRuntime = new WeakMap<object, Map<string, WorktreeCreateEntry>>()

export async function runIdempotentWorktreeCreate<TResult>(args: {
  runtime: object
  clientMutationId: string | undefined
  params: unknown
  create: () => Promise<TResult>
}): Promise<TResult> {
  if (!args.clientMutationId) {
    return args.create()
  }
  const clientMutationId = args.clientMutationId

  let entries = worktreeCreatesByRuntime.get(args.runtime)
  if (!entries) {
    entries = new Map()
    worktreeCreatesByRuntime.set(args.runtime, entries)
  }

  const existing = entries.get(clientMutationId)
  if (existing) {
    if (!isDeepStrictEqual(existing.params, args.params)) {
      throw new InvalidArgumentError(
        'clientMutationId cannot be reused with different worktree.create parameters'
      )
    }
    return existing.result as Promise<TResult>
  }

  // Why: publish the promise before creation begins so concurrent migration replays
  // share one mutation; retain success briefly for a response lost during cutover.
  const entry: WorktreeCreateEntry = {
    params: args.params,
    result: Promise.resolve().then(args.create)
  }
  entries.set(clientMutationId, entry)
  const drop = (): void => {
    if (entries?.get(clientMutationId) === entry) {
      entries.delete(clientMutationId)
    }
  }
  void entry.result.then(() => {
    setTimeout(drop, WORKTREE_CREATE_RESULT_TTL_MS).unref?.()
  }, drop)
  return entry.result as Promise<TResult>
}

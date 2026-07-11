import type { MarkdownDocument } from '../../../../shared/types'
import {
  listRuntimeMarkdownDocuments,
  type RuntimeFileOperationArgs
} from '@/runtime/runtime-file-client'

type MarkdownDocumentListLoader = (
  context: RuntimeFileOperationArgs,
  rootPath: string
) => Promise<MarkdownDocument[]>

type MarkdownDocumentListRequestOptions = {
  requireFresh?: boolean
}

type InFlightMarkdownDocumentList = {
  request: Promise<MarkdownDocument[]>
  startedAt: number
}

const MARKDOWN_DOCUMENT_LIST_JOIN_WINDOW_MS = 30_000
const inFlightMarkdownDocumentLists = new Map<string, InFlightMarkdownDocumentList>()

export function getMarkdownDocumentListRequestKey(
  context: RuntimeFileOperationArgs,
  rootPath: string
): string {
  return JSON.stringify([
    context.settings?.activeRuntimeEnvironmentId?.trim() ?? '',
    context.connectionId ?? '',
    context.worktreeId ?? '',
    context.worktreePath ?? '',
    rootPath
  ])
}

export function requestSharedMarkdownDocumentList(
  context: RuntimeFileOperationArgs,
  rootPath: string,
  options: MarkdownDocumentListRequestOptions = {},
  load: MarkdownDocumentListLoader = listRuntimeMarkdownDocuments
): Promise<MarkdownDocument[]> {
  const key = getMarkdownDocumentListRequestKey(context, rootPath)
  const existing = inFlightMarkdownDocumentLists.get(key)
  const existingAge = existing ? performance.now() - existing.startedAt : null
  if (
    existing &&
    !options.requireFresh &&
    existingAge !== null &&
    existingAge < MARKDOWN_DOCUMENT_LIST_JOIN_WINDOW_MS
  ) {
    return existing.request
  }

  // Why: split Markdown panes mount together and otherwise launch identical
  // whole-worktree local/SSH scans; mutation refreshes bypass older snapshots.
  const request = load(context, rootPath).finally(() => {
    if (inFlightMarkdownDocumentLists.get(key)?.request === request) {
      inFlightMarkdownDocumentLists.delete(key)
    }
  })
  // Why: local and UNC filesystem calls have no timeout, so an abandoned scan
  // must not suppress every ordinary retry for the renderer's lifetime.
  inFlightMarkdownDocumentLists.set(key, { request, startedAt: performance.now() })
  return request
}
